@echo off
title GOVIA WhatsApp Bot Service
cd /d "%~dp0backend\wa-service"
echo ===================================================
echo     MEMULAI CHAT BOT WHATSAPP GOVIA (BAILEYS)
echo ===================================================
echo.
echo Microservice aktif di port 3002.
echo Jika baru pertama kali jalan, scan QR code di bawah ini
echo menggunakan WhatsApp di HP Anda (Perangkat Tertaut).
echo.
npm start
pause

