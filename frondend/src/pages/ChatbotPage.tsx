import { useState, useRef, useEffect, type ReactNode } from 'react';
import '../Style/chatbot.css';
import Navbar from '../components/Navbar';
import logoNavbar from '../assets/LogoNavbar.png';
import {
  bookingApi,
  chatApi,
  getStoredUser,
  getToken,
  type ChatBookingCreatedCard,
  type ChatHistoryItem,
  type ChatSeatPickerCard,
  type ChatUiCard,
} from '../services/api';

interface ChatbotPageProps {
  onNavigate: (page: string, params?: { scheduleId?: string; bookingCode?: string }) => void;
}

interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time: string;
  cards?: ChatUiCard[];
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'm1',
  sender: 'ai',
  text: 'Halo! Saya **GOVIA AI** (didukung **Google Gemini**). Saya siap menemani Anda mengobrol bebas seputar perjalanan, rekomendasi wisata/kuliner, hingga membantu **mencari jadwal, memilih kursi, dan memesan tiket bus** langsung di sini.\n\nCoba ketik rute yang Anda cari, misalnya *"Cari tiket bus Jakarta ke Surabaya"* atau *"Saya mau pesan tiket bus"*!',
  time: 'Baru saja',
};

function formatRupiah(amount: number): string {
  return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

function formatTanggalID(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(`${dateStr}T00:00:00+07:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatPaymentLabel(metode: string | null | undefined): string {
  switch (String(metode || '').toLowerCase()) {
    case 'qris':
      return 'QRIS';
    case 'virtual_account':
      return 'Virtual Account';
    case 'ewallet':
      return 'E-Wallet';
    case 'cash':
      return 'Cash (Tunai saat naik)';
    default:
      return metode || 'QRIS';
  }
}

function formatStatusLabel(status: string): { label: string; tone: 'green' | 'amber' | 'red' } {
  const s = String(status || '').toLowerCase();
  if (s === 'lunas' || s === 'terkonfirmasi') return { label: 'Lunas / Aktif', tone: 'green' };
  if (s === 'menunggu_bayar' || s === 'pending') return { label: 'Menunggu Pembayaran', tone: 'amber' };
  return { label: status, tone: 'red' };
}

/** Render teks markdown ringan (**tebal**, `kode`, bullet list) secara aman tanpa HTML mentah */
function renderInlineSegments(line: string, keyPrefix: string): ReactNode[] {
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-b-${idx}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={`${keyPrefix}-c-${idx}`} className="cb-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t-${idx}`}>{part}</span>;
  });
}

function renderFormattedText(text: string): ReactNode {
  const lines = String(text || '').split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listItems: Array<{ ordered: boolean; content: string }> = [];

  const flushList = (keySeed: number) => {
    if (listItems.length === 0) return;
    const isOrdered = listItems[0].ordered;
    const Tag = isOrdered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${keySeed}`} className="cb-md-list">
        {listItems.map((item, idx) => (
          <li key={`li-${keySeed}-${idx}`}>{renderInlineSegments(item.content, `li-${keySeed}-${idx}`)}</li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList(idx);
      return;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (bulletMatch) {
      if (listItems.length > 0 && listItems[0].ordered) flushList(idx);
      listItems.push({ ordered: false, content: bulletMatch[1] });
      return;
    }

    if (orderedMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList(idx);
      listItems.push({ ordered: true, content: orderedMatch[1] });
      return;
    }

    flushList(idx);
    blocks.push(
      <p key={`p-${idx}`} className="cb-md-p">
        {renderInlineSegments(trimmed, `p-${idx}`)}
      </p>
    );
  });

  flushList(lines.length + 1);
  return <div className="cb-md-content">{blocks}</div>;
}

interface InlinePassengerDraft {
  nama_penumpang: string;
  no_identitas: string;
  no_hp: string;
}

interface InlineSeatBookingCardProps {
  card: ChatSeatPickerCard;
  onNavigate: ChatbotPageProps['onNavigate'];
  onBookingSuccess: (bookingCard: ChatBookingCreatedCard, serverMessage: string) => void;
}

function InlineSeatBookingCard({ card, onNavigate, onBookingSuccess }: InlineSeatBookingCardProps) {
  const storedUser = getStoredUser();
  const isAuthenticated = Boolean(getToken() && storedUser?.id);

  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [passengers, setPassengers] = useState<InlinePassengerDraft[]>([]);
  const [metode, setMetode] = useState<'qris' | 'virtual_account' | 'ewallet' | 'cash'>('qris');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [createdKode, setCreatedKode] = useState<string | null>(null);

  const handleToggleSeat = (seatCode: string) => {
    if (submitting || createdKode) return;
    setErrorMsg(null);

    if (selectedSeats.includes(seatCode)) {
      const removeIdx = selectedSeats.indexOf(seatCode);
      setSelectedSeats((prev) => prev.filter((c) => c !== seatCode));
      setPassengers((prev) => prev.filter((_, idx) => idx !== removeIdx));
      return;
    }

    if (selectedSeats.length >= 4) {
      setErrorMsg('Maksimal 4 kursi dalam satu kali pemesanan.');
      return;
    }

    const nextIdx = selectedSeats.length;
    const defaultName =
      nextIdx === 0 ? card.prefill_user?.nama || storedUser?.nama || '' : '';
    const defaultPhone =
      nextIdx === 0 ? card.prefill_user?.no_hp || storedUser?.no_hp || '' : '';

    setSelectedSeats((prev) => [...prev, seatCode]);
    setPassengers((prev) => [
      ...prev,
      { nama_penumpang: defaultName, no_identitas: '', no_hp: defaultPhone },
    ]);
  };

  const updatePassenger = (idx: number, field: keyof InlinePassengerDraft, value: string) => {
    setPassengers((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const handleConfirmBooking = async () => {
    if (selectedSeats.length === 0) {
      setErrorMsg('Pilih minimal 1 kursi terlebih dahulu.');
      return;
    }
    if (!isAuthenticated) {
      setErrorMsg('Silakan login terlebih dahulu untuk memesan tiket.');
      return;
    }

    for (let i = 0; i < selectedSeats.length; i++) {
      const p = passengers[i];
      if (!p?.nama_penumpang.trim() || !p?.no_identitas.trim() || !p?.no_hp.trim()) {
        setErrorMsg(`Lengkapi Nama, NIK, dan No. WhatsApp untuk Kursi ${selectedSeats[i]}.`);
        return;
      }
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await bookingApi.lockSeats({
        schedule_id: String(card.schedule.id),
        metode_pembayaran: metode,
        passengers: selectedSeats.map((code, idx) => ({
          nomor_kursi: code,
          nama_penumpang: passengers[idx].nama_penumpang.trim(),
          no_identitas: passengers[idx].no_identitas.trim(),
          no_hp: passengers[idx].no_hp.trim(),
        })),
      });

      const bookingCard: ChatBookingCreatedCard = {
        type: 'booking_created',
        booking: {
          kode_booking: res.booking.kode_booking,
          total_harga: Number(res.booking.total_harga || 0),
          status: res.booking.status,
          is_cash: Boolean(res.is_cash),
          expired_at: res.booking.expired_at,
          metode_pembayaran: res.booking.payment?.metode || metode,
          nama_bus: card.schedule.nama_bus,
          plat_nomor: card.schedule.plat_nomor,
          kelas: card.schedule.kelas,
          asal_kota: card.schedule.asal_kota,
          tujuan_kota: card.schedule.tujuan_kota,
          tanggal_berangkat: card.schedule.tanggal_berangkat,
          jam_berangkat: card.schedule.jam_berangkat,
          tickets: res.booking.tickets.map((t) => ({
            kode_tiket: t.kode_tiket,
            nama_penumpang: t.nama_penumpang,
            nomor_kursi: t.nomor_kursi || '-',
          })),
        },
      };

      setCreatedKode(res.booking.kode_booking);
      onBookingSuccess(bookingCard, res.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat pesanan.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const totalEstimate = selectedSeats.length * Number(card.schedule.harga || 0);

  return (
    <div className="cb-card-box">
      <div className="cb-card-head">
        <div>
          <span className="cb-card-eyebrow">Pilih Kursi Langsung • ID #{card.schedule.id}</span>
          <h4 className="cb-card-title">
            {card.schedule.nama_bus} ({card.schedule.kelas.toUpperCase()})
          </h4>
          <p className="cb-card-sub">
            {card.schedule.asal_kota} → {card.schedule.tujuan_kota} •{' '}
            {formatTanggalID(card.schedule.tanggal_berangkat)} {card.schedule.jam_berangkat} WIB
          </p>
        </div>
        <span className="cb-price-pill">{formatRupiah(card.schedule.harga)} / kursi</span>
      </div>

      {createdKode ? (
        <div className="cb-inline-done">
          <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#16a34a' }}>
            check_circle
          </span>
          <span>
            Pesanan <strong>{createdKode}</strong> sudah dibuat di kartu konfirmasi di bawah.
          </span>
        </div>
      ) : (
        <>
          <div className="cb-seat-legend">
            <span>Klik nomor kursi tersedia (maks. 4 kursi):</span>
            <span className="cb-seat-count">{card.available_seats.length} kursi tersedia</span>
          </div>

          <div className="cb-seat-grid">
            {card.seats.map((seat) => {
              const isOccupied = seat.status === 'terisi';
              const isSelected = selectedSeats.includes(seat.nomor_kursi);
              return (
                <button
                  key={seat.seat_id}
                  type="button"
                  disabled={isOccupied || submitting}
                  onClick={() => handleToggleSeat(seat.nomor_kursi)}
                  className={`cb-seat-btn ${
                    isOccupied
                      ? 'cb-seat-occupied'
                      : isSelected
                        ? 'cb-seat-selected'
                        : 'cb-seat-available'
                  }`}
                >
                  {seat.nomor_kursi}
                </button>
              );
            })}
          </div>

          {selectedSeats.length > 0 && (
            <div className="cb-inline-form">
              <div className="cb-inline-summary">
                <span>
                  Kursi dipilih: <strong>{selectedSeats.join(', ')}</strong>
                </span>
                <strong>Total: {formatRupiah(totalEstimate)}</strong>
              </div>

              {!isAuthenticated ? (
                <div className="cb-login-banner">
                  <span>Anda perlu masuk ke akun GOVIA untuk menyelesaikan pemesanan ini.</span>
                  <div className="cb-card-actions">
                    <button
                      type="button"
                      className="cb-card-btn-primary"
                      onClick={() => onNavigate('login')}
                    >
                      Masuk Sekarang
                    </button>
                    <button
                      type="button"
                      className="cb-card-btn-secondary"
                      onClick={() => onNavigate('seats', { scheduleId: card.schedule.id })}
                    >
                      Buka Halaman Kursi
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {selectedSeats.map((seatCode, idx) => (
                    <div key={seatCode} className="cb-passenger-box">
                      <div className="cb-passenger-label">Data Penumpang • Kursi {seatCode}</div>
                      <div className="cb-passenger-fields">
                        <input
                          type="text"
                          placeholder="Nama lengkap sesuai KTP"
                          value={passengers[idx]?.nama_penumpang || ''}
                          onChange={(e) => updatePassenger(idx, 'nama_penumpang', e.target.value)}
                          className="cb-mini-input"
                        />
                        <input
                          type="text"
                          placeholder="NIK / No. Identitas (16 digit)"
                          value={passengers[idx]?.no_identitas || ''}
                          onChange={(e) => updatePassenger(idx, 'no_identitas', e.target.value)}
                          className="cb-mini-input"
                        />
                        <input
                          type="tel"
                          placeholder="No. HP / WhatsApp aktif"
                          value={passengers[idx]?.no_hp || ''}
                          onChange={(e) => updatePassenger(idx, 'no_hp', e.target.value)}
                          className="cb-mini-input"
                        />
                      </div>
                    </div>
                  ))}

                  <div className="cb-method-row">
                    <span className="cb-passenger-label">Metode Pembayaran:</span>
                    <div className="cb-method-pills">
                      {(
                        [
                          { id: 'qris', label: 'QRIS' },
                          { id: 'virtual_account', label: 'Virtual Account' },
                          { id: 'ewallet', label: 'E-Wallet' },
                          { id: 'cash', label: 'Cash saat naik' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setMetode(opt.id)}
                          className={`cb-method-pill ${metode === opt.id ? 'active' : ''}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {errorMsg && <div className="cb-inline-error">{errorMsg}</div>}

                  <div className="cb-card-actions">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleConfirmBooking}
                      className="cb-card-btn-primary"
                    >
                      {submitting ? 'Memproses Pesanan...' : `Konfirmasi & Pesan (${formatRupiah(totalEstimate)})`}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => onNavigate('seats', { scheduleId: card.schedule.id })}
                      className="cb-card-btn-secondary"
                    >
                      Denah Penuh & Titik Jemput
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {selectedSeats.length === 0 && errorMsg && (
            <div className="cb-inline-error">{errorMsg}</div>
          )}
        </>
      )}
    </div>
  );
}

export function ChatbotPage({ onNavigate }: ChatbotPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [aiEngine, setAiEngine] = useState<{
    mode: 'ready' | 'gemini' | 'fallback';
    model?: string;
  }>({ mode: 'ready' });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messageCounterRef = useRef(100);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScrollMessages = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    setShowScrollBottomBtn(scrollHeight - scrollTop - clientHeight > 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAiTyping]);

  const handleResetChat = () => {
    if (isAiTyping) return;
    setMessages([WELCOME_MESSAGE]);
    setInputText('');
  };

  const handleInlineBookingSuccess = (
    bookingCard: ChatBookingCreatedCard,
    serverMessage: string
  ) => {
    const aiMsg: ChatMessage = {
      id: `ai_${++messageCounterRef.current}`,
      sender: 'ai',
      text: `**Pesanan Berhasil Dibuat!**\n\n${serverMessage}\n\nKode Booking Anda: \`${bookingCard.booking.kode_booking}\`. ${
        bookingCard.booking.is_cash
          ? 'Tiket langsung aktif untuk pembayaran Cash saat naik bus. Silakan buka E-Ticket & QR Anda!'
          : 'Silakan lanjutkan ke halaman pembayaran untuk menyelesaikan transaksi sebelum batas waktu berakhir.'
      }`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      cards: [bookingCard],
    };
    setMessages((prev) => [...prev, aiMsg]);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isAiTyping) return;

    const currentTime =
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' WIB';
    const nextUserMsgId = `u_${++messageCounterRef.current}`;

    const userMsg: ChatMessage = {
      id: nextUserMsgId,
      sender: 'user',
      text,
      time: currentTime,
    };

    // Kirim riwayat percakapan nyata (kecuali sapaan statis awal m1) agar konteks selalu dimulai dari user
    const history: ChatHistoryItem[] = messages
      .filter((m) => m.id !== 'm1')
      .slice(-18)
      .map((m) => ({ role: m.sender === 'user' ? 'user' : 'model', text: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setIsAiTyping(true);

    try {
      const res = await chatApi.send({ message: text, history });
      const responseText =
        res.reply || 'Maaf, saya tidak dapat memproses pertanyaan itu saat ini.';

      setAiEngine({ mode: res.mode, model: res.model });

      const aiMsg: ChatMessage = {
        id: `ai_${++messageCounterRef.current}`,
        sender: 'ai',
        text: responseText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' WIB',
        cards: Array.isArray(res.cards) && res.cards.length > 0 ? res.cards : undefined,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setAiEngine({ mode: 'fallback' });
      setMessages((prev) => [
        ...prev,
        {
          id: `ai_${++messageCounterRef.current}`,
          sender: 'ai',
          text: 'Maaf, koneksi ke asisten AI sedang terganggu. Pastikan server backend (`localhost:3000`) aktif lalu coba kirim pesan Anda kembali.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' WIB',
        },
      ]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const renderCard = (card: ChatUiCard, idx: number) => {
    if (card.type === 'schedules') {
      return (
        <div key={`card-sched-${idx}`} className="cb-card-box">
          <div className="cb-card-head">
            <div>
              <span className="cb-card-eyebrow">Data Langsung Database GOVIA</span>
              <h4 className="cb-card-title">{card.title}</h4>
            </div>
            <span className="cb-count-pill">{card.schedules.length} Jadwal</span>
          </div>

          <div className="cb-sched-list">
            {card.schedules.map((s) => (
              <div key={s.id} className="cb-sched-item">
                <div className="cb-sched-main">
                  <div className="cb-sched-bus-row">
                    <strong>{s.nama_bus}</strong>
                    <span className="cb-class-tag">{s.kelas.toUpperCase()}</span>
                    <span className="cb-id-tag">ID #{s.id}</span>
                  </div>
                  <div className="cb-sched-route">
                    {s.asal_kota} ({s.asal_terminal}) → {s.tujuan_kota} ({s.tujuan_terminal})
                  </div>
                  <div className="cb-sched-meta">
                    <span>{formatTanggalID(s.tanggal_berangkat)}</span>
                    <span>•</span>
                    <span>
                      {s.jam_berangkat} - {s.jam_tiba} WIB
                    </span>
                    <span>•</span>
                    <span className={s.sisa_kursi > 0 ? 'cb-seat-ok' : 'cb-seat-empty'}>
                      Sisa {s.sisa_kursi} kursi
                    </span>
                  </div>
                </div>

                <div className="cb-sched-side">
                  <div className="cb-sched-price">{formatRupiah(s.harga)}</div>
                  <div className="cb-sched-btns">
                    <button
                      type="button"
                      className="cb-card-btn-primary"
                      disabled={isAiTyping || s.sisa_kursi <= 0}
                      onClick={() =>
                        handleSendMessage(
                          `Saya mau pesan ${s.nama_bus} (${s.asal_kota} → ${s.tujuan_kota}, jadwal ID ${s.id}), tolong tampilkan kursi yang tersedia.`
                        )
                      }
                    >
                      Pesan di Chat
                    </button>
                    <button
                      type="button"
                      className="cb-card-btn-secondary"
                      onClick={() => onNavigate('seats', { scheduleId: s.id })}
                    >
                      Denah Penuh
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (card.type === 'seat_picker') {
      return (
        <InlineSeatBookingCard
          key={`card-seat-${card.schedule.id}-${idx}`}
          card={card}
          onNavigate={onNavigate}
          onBookingSuccess={handleInlineBookingSuccess}
        />
      );
    }

    if (card.type === 'booking_created') {
      const b = card.booking;
      const statusBadge = formatStatusLabel(b.status);
      return (
        <div key={`card-booked-${b.kode_booking}-${idx}`} className="cb-card-box cb-booking-success">
          <div className="cb-card-head">
            <div>
              <span className="cb-card-eyebrow">Konfirmasi Pemesanan Tiket</span>
              <h4 className="cb-card-title">Kode Booking: {b.kode_booking}</h4>
            </div>
            <span className={`cb-status-pill cb-tone-${statusBadge.tone}`}>
              {statusBadge.label}
            </span>
          </div>

          <div className="cb-booked-meta">
            <div>
              <span>Bus &amp; Rute</span>
              <strong>
                {b.nama_bus} • {b.asal_kota} → {b.tujuan_kota}
              </strong>
            </div>
            <div>
              <span>Keberangkatan</span>
              <strong>
                {formatTanggalID(b.tanggal_berangkat)} {b.jam_berangkat} WIB
              </strong>
            </div>
            <div>
              <span>Pembayaran</span>
              <strong>{formatPaymentLabel(b.metode_pembayaran)}</strong>
            </div>
            <div>
              <span>Total Biaya</span>
              <strong>{formatRupiah(b.total_harga)}</strong>
            </div>
          </div>

          <div className="cb-booked-tickets">
            {b.tickets.map((t) => (
              <div key={t.kode_tiket} className="cb-booked-ticket-row">
                <span>
                  Kursi <strong>{t.nomor_kursi}</strong> — {t.nama_penumpang}
                </span>
                <code className="cb-inline-code">{t.kode_tiket}</code>
              </div>
            ))}
          </div>

          <div className="cb-card-actions">
            {b.is_cash || b.status === 'lunas' ? (
              <button
                type="button"
                className="cb-card-btn-primary"
                onClick={() => onNavigate('ticket', { bookingCode: b.kode_booking })}
              >
                Buka E-Ticket &amp; QR
              </button>
            ) : (
              <button
                type="button"
                className="cb-card-btn-primary"
                onClick={() => onNavigate('payment', { bookingCode: b.kode_booking })}
              >
                Lanjut ke Pembayaran
              </button>
            )}
            <button
              type="button"
              className="cb-card-btn-secondary"
              onClick={() => onNavigate('pesanan')}
            >
              Lihat Pesanan Saya
            </button>
          </div>
        </div>
      );
    }

    if (card.type === 'booking_status') {
      return (
        <div key={`card-bstatus-${idx}`} className="cb-card-box">
          <div className="cb-card-head">
            <div>
              <span className="cb-card-eyebrow">Riwayat &amp; Status Pesanan</span>
              <h4 className="cb-card-title">Daftar Pemesanan Tiket</h4>
            </div>
            <span className="cb-count-pill">{card.bookings.length} Booking</span>
          </div>

          <div className="cb-sched-list">
            {card.bookings.map((b) => {
              const badge = formatStatusLabel(b.status);
              const isPaid = b.status === 'lunas';
              return (
                <div key={b.kode_booking} className="cb-sched-item">
                  <div className="cb-sched-main">
                    <div className="cb-sched-bus-row">
                      <strong>{b.kode_booking}</strong>
                      <span className={`cb-status-pill cb-tone-${badge.tone}`}>{badge.label}</span>
                    </div>
                    <div className="cb-sched-route">
                      {b.nama_bus} • {b.asal_kota} → {b.tujuan_kota}
                    </div>
                    <div className="cb-sched-meta">
                      <span>{formatTanggalID(b.tanggal_berangkat)}</span>
                      <span>•</span>
                      <span>Kursi: {b.kursi}</span>
                      <span>•</span>
                      <span>{formatPaymentLabel(b.metode_pembayaran)}</span>
                    </div>
                  </div>

                  <div className="cb-sched-side">
                    <div className="cb-sched-price">{formatRupiah(b.total_harga)}</div>
                    <div className="cb-sched-btns">
                      {isPaid ? (
                        <button
                          type="button"
                          className="cb-card-btn-primary"
                          onClick={() => onNavigate('ticket', { bookingCode: b.kode_booking })}
                        >
                          Buka E-Ticket
                        </button>
                      ) : b.status === 'menunggu_bayar' ? (
                        <button
                          type="button"
                          className="cb-card-btn-primary"
                          onClick={() => onNavigate('payment', { bookingCode: b.kode_booking })}
                        >
                          Bayar Sekarang
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (card.type === 'login_required') {
      return (
        <div key={`card-login-${idx}`} className="cb-card-box cb-login-card">
          <div className="cb-card-head">
            <div>
              <span className="cb-card-eyebrow">Autentikasi Diperlukan</span>
              <h4 className="cb-card-title">Masuk ke Akun GOVIA</h4>
            </div>
          </div>
          <p className="cb-card-sub" style={{ marginBottom: '0.75rem' }}>
            {card.reason}
          </p>
          <div className="cb-card-actions">
            <button
              type="button"
              className="cb-card-btn-primary"
              onClick={() => onNavigate('login')}
            >
              Masuk Sekarang
            </button>
            <button
              type="button"
              className="cb-card-btn-secondary"
              onClick={() => onNavigate('register')}
            >
              Daftar Akun
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  const badgeLabel =
    aiEngine.mode === 'gemini' && aiEngine.model
      ? `GOOGLE GEMINI AKTIF • ${aiEngine.model.toUpperCase()}`
      : aiEngine.mode === 'fallback'
        ? 'MODE CADANGAN LOKAL • CEK KONEKSI GEMINI'
        : 'GOOGLE GEMINI AI • TERHUBUNG KE DATABASE JADWAL & KURSI';

  return (
    <div className="cb-page-container">
      {/* ── SHARED NAVBAR (Full Variant) ───────────────────────── */}
      <Navbar onNavigate={onNavigate} variant="full" ctaLabel="Masuk / Daftar" ctaTarget="login" />

      {/* ── TOP BREADCRUMB & STATUS BAR ────────────────────────── */}
      <div className="cb-top-bar">
        <div className="cb-top-bar-inner">
          <div className="cb-breadcrumb">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '16px', cursor: 'pointer' }}
              onClick={() => onNavigate('search')}
            >
              home
            </span>
            <span>Beranda</span>
            <span>/</span>
            <span className="cb-breadcrumb-active">Tanya GOVIA AI (Asisten Perjalanan &amp; Pemesanan Tiket)</span>
          </div>

          <div className="cb-neural-badge">
            <span
              className="cb-dot-pulse"
              style={aiEngine.mode === 'fallback' ? { backgroundColor: '#f59e0b' } : undefined}
            ></span>
            <span>{badgeLabel}</span>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT GRID ───────────────────────────────────── */}
      <main className="cb-main-content">
        <div className="cb-grid-layout">
          {/* ── CHAT INTERFACE ──────────────── */}
          <section className="cb-chat-panel anim-zoom-in">
            {/* Header: AI Assistant Profile */}
            <div className="cb-chat-header">
              <div className="cb-assistant-info">
                <div className="cb-assistant-avatar">
                  <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
                    smart_toy
                  </span>
                </div>
                <div>
                  <h2 className="cb-assistant-name">
                    GOVIA AI Assistant
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#16a34a' }}>
                      verified
                    </span>
                  </h2>
                  <div className="cb-assistant-sub">
                    <span
                      className="cb-dot-pulse"
                      style={{
                        width: '6px',
                        height: '6px',
                        ...(aiEngine.mode === 'fallback' ? { backgroundColor: '#f59e0b' } : {}),
                      }}
                    ></span>
                    <span>
                      {aiEngine.mode === 'gemini' && aiEngine.model
                        ? `Didukung Google Gemini (${aiEngine.model}) • Bisa Pesan Tiket Langsung`
                        : 'Online 24/7 • Ngobrol Bebas & Pesan Tiket Bus Langsung'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="cb-chat-header-actions">
                <button
                  type="button"
                  onClick={handleResetChat}
                  disabled={isAiTyping}
                  className="cb-reset-btn"
                  title="Mulai percakapan baru"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    refresh
                  </span>
                  <span>Chat Baru</span>
                </button>
              </div>
            </div>

            {/* Chat Messages Stream Log */}
            <div
              className="cb-messages-area"
              ref={messagesContainerRef}
              onScroll={handleScrollMessages}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`cb-message-row ${msg.sender === 'user' ? 'cb-message-user' : 'cb-message-ai'}`}
                >
                  {msg.sender === 'ai' && (
                    <div className="cb-msg-avatar">
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                        smart_toy
                      </span>
                    </div>
                  )}

                  <div className="cb-msg-col">
                    <div
                      className={`cb-msg-bubble ${
                        msg.sender === 'user' ? 'cb-msg-bubble-user' : 'cb-msg-bubble-ai'
                      }`}
                    >
                      {msg.sender === 'ai' ? renderFormattedText(msg.text) : <p>{msg.text}</p>}
                    </div>

                    {msg.cards && msg.cards.length > 0 && (
                      <div className="cb-cards-wrap">
                        {msg.cards.map((card, cIdx) => renderCard(card, cIdx))}
                      </div>
                    )}

                    {/* Timestamp */}
                    <div
                      className={`cb-msg-time ${
                        msg.sender === 'user' ? 'cb-msg-time-user' : 'cb-msg-time-ai'
                      }`}
                    >
                      <span>{msg.time}</span>
                      {msg.sender === 'user' && (
                        <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#93c5fd' }}>
                          done_all
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Indikator AI sedang mengetik */}
              {isAiTyping && (
                <div className="cb-message-row cb-message-ai">
                  <div className="cb-msg-avatar">
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                      smart_toy
                    </span>
                  </div>
                  <div
                    className="cb-msg-bubble cb-msg-bubble-ai"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}
                    >
                      progress_activity
                    </span>
                    <span>GOVIA AI sedang berpikir...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Floating Scroll Bottom Button */}
            {showScrollBottomBtn && (
              <button type="button" onClick={scrollToBottom} className="cb-scroll-bottom-btn">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                  arrow_downward
                </span>
                <span>Pesan Terbaru</span>
              </button>
            )}

            {/* Quick Prompt Chips */}
            <div className="cb-quick-prompts">
              {[
                {
                  label: 'Pesan Tiket Bus',
                  prompt: 'Saya ingin memesan tiket bus, tolong tampilkan jadwal yang tersedia.',
                  icon: 'confirmation_number',
                },
                {
                  label: 'Cek Jadwal Jakarta - Surabaya',
                  prompt: 'Cek jadwal bus yang tersedia dari Jakarta ke Surabaya beserta harganya.',
                  icon: 'directions_bus',
                },
                {
                  label: 'Cek Pesanan Saya',
                  prompt: 'Tolong cek status pemesanan tiket saya.',
                  icon: 'receipt_long',
                },
                {
                  label: 'Rekomendasi Wisata & Kuliner',
                  prompt: 'Berikan rekomendasi tempat wisata dan kuliner wajib coba saat tiba di Surabaya atau Yogyakarta!',
                  icon: 'explore',
                },
                {
                  label: 'Metode Bayar & Refund',
                  prompt: 'Jelaskan metode pembayaran yang tersedia dan ketentuan refund/reschedule tiket.',
                  icon: 'payments',
                },
              ].map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isAiTyping}
                  onClick={() => handleSendMessage(item.prompt)}
                  className={`cb-prompt-chip anim-fade-up anim-d${idx + 1}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* Input Action Bar */}
            <div className="cb-input-area">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="cb-input-row"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ketik pesan apa saja: cari jadwal, pesan tiket & kursi, atau ngobrol soal perjalanan..."
                  className="cb-input-field"
                />

                <button type="submit" disabled={isAiTyping} className="cb-send-btn">
                  <span>Kirim</span>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    send
                  </span>
                </button>
              </form>

              {/* Security & Footer info */}
              <div className="cb-chat-footer-note">
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '12px', color: '#16a34a' }}>
                    lock
                  </span>
                  Transaksi Terenkripsi &amp; Terhubung Real-Time ke Sistem Kursi GOVIA
                </span>
                <span>Didukung Google Gemini AI</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ── FULL WEBSITE FOOTER ────────────────────────────────────── */}
      <footer className="cb-site-footer">
        <div className="cb-footer-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.25rem' }}>
              <img
                src={logoNavbar}
                alt="GOVIA Transport"
                style={{ height: '2.25rem', width: 'auto', objectFit: 'contain' }}
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: '#747783', lineHeight: '1.5', maxWidth: '24rem' }}>
              Platform pemesanan tiket bus intercity dan travel terpercaya di Indonesia. Memastikan kenyamanan,
              ketepatan waktu, dan kemudahan mobilitas antar pulau.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h4
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#1B4285',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Rute Populer
            </h4>
            <ul
              style={{
                fontSize: '0.75rem',
                color: '#434652',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.375rem',
                fontWeight: 500,
                listStyle: 'none',
              }}
            >
              <li>Jakarta - Surabaya</li>
              <li>Jakarta - Yogyakarta</li>
              <li>Bandung - Solo</li>
              <li>Surabaya - Denpasar (Bali)</li>
            </ul>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h4
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#1B4285',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Bantuan &amp; Layanan
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#434652', fontWeight: 600 }}>Layanan Pelanggan 24/7</p>
            <p style={{ fontSize: '0.75rem', color: '#747783' }}>WhatsApp: +62 811-2345-6789</p>
            <p style={{ fontSize: '0.75rem', color: '#747783' }}>Email: bantuan@govia.id</p>
          </div>
        </div>

        <div className="cb-footer-copyright">
          <span>&copy; 2025 PT GOVIA Nusantara Indonesia. Hak Cipta Dilindungi.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#16a34a' }}>
                shield
              </span>
              Pembayaran 100% Aman
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#1B4285' }}>
                schedule
              </span>
              Keberangkatan Tepat Waktu
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
