# Taxi Application - Backend

This is a starter backend for the taxi application using Express and MongoDB.

Features included:
- User model (rider/driver)
- Ride model with geo fields
- Auth routes: register, login, reset password (email)
- Ride routes: create ride, list available rides (nearby), get ride details, accept ride
- Email utility using nodemailer

Quick start

1. Copy `.env.example` to `.env` and fill values (MongoDB URI, email SMTP, JWT secret, frontend url).

2. Install dependencies:

```bash
cd backend
npm install
```

3. Start in development:

```bash
npm run dev
```

Endpoints

- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/reset-request
- POST /api/auth/reset

- POST /api/rides/           (create ride) [rider]
- GET  /api/rides/available  (list available rides near point) [driver]
- GET  /api/rides/:id        (ride details)
- POST /api/rides/:id/accept (accept ride) [driver]

Driver accounts

- Public registration (`POST /api/auth/register`) is restricted to riders only. Drivers must be created manually (this avoids drivers self-registering).

To create a driver account locally, use the included script:

```bash
# from the backend folder
node scripts/createDriver.js "Driver Name" driver@example.com password123 
```

The script will create a driver with `role: 'driver'` and `verified: true`.

Notes

- This is a basic scaffold. You'll want to harden validation, error handling, and production email delivery.
