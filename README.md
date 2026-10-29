# SQMS - Smart Queue Time Management System

A hospital queue management system with public patient booking, live token tracking, priority-aware queues, doctor controls, multilingual alerts, role-based staff access, and operational analytics.

## Stack

- **API:** Node.js, Express, Socket.IO, SQLite via the built-in `node:sqlite` module
- **Web:** React 18, Vite, React Router, Lucide icons
- **Alerts:** In-app/SMS notifications, browser speech synthesis in English, Hindi, and Marathi
- **Structure:** npm workspaces with `apps/api` and `apps/web`

## Requirements

- Node.js **22.5 or newer** (`node:sqlite` is required; tested on Node 24)
- npm 10 or newer

## Quick Start

```bash
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000
- Live display board: http://localhost:5173/display

The Vite development server proxies `/api` and `/socket.io` to the API.

### Production-style run

```bash
npm run build
npm start
```

The API serves the built React app and API from http://localhost:4000.

### Reset demo data

```bash
npm run reset-db --workspace=@sqms/api
```

This removes the current SQLite database and reseeds departments, 10 doctors, and staff accounts only. No demo patients, bookings, or historical analytics records are preloaded, so every queue starts clean.

## Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@sqms.health` | `admin123` |
| Doctor - Cardiology | `cardio@sqms.health` | `doctor123` |
| Doctor - General Medicine | `medicine@sqms.health` | `doctor123` |
| Nurse | `nurse@sqms.health` | `nurse123` |
| Receptionist | `reception@sqms.health` | `reception123` |

Patients do not need an account. They book or take a token and receive a token number such as `GEN-006` plus a full tracking code such as `GEN-261029-006`. Either value works on `/track`. Generated tokens are saved automatically in the browser on that device and can be reopened from the home page or `/track` without signing in.

## Features

### Patient portal

- Book a same-day walk-in token or reserve an appointment up to 30 days ahead
- Choose department, doctor, language, and priority category
- Receive a tracking code, live queue position, estimated wait, and estimated consultation time
- Self check-in for today's appointments and self-cancellation while waiting
- View in-app notifications and hear spoken alerts in the selected language
- Public multilingual hospital display board with auto-refresh and live socket updates

### Clinical workflow

- Priority ordering: emergency first, then senior/pregnant/differently abled, then general; FIFO within each tier
- Doctor actions: call next, call a specific patient, start consultation, complete, skip, recall, pause, and resume
- Queue pause adds delay context to live ETA calculations
- Front desk: register patients, check in appointments, update triage priority, search tickets, cancel bookings
- Turn, delay, custom, and resume alerts sent through SMS, in-app, and voice channels
- Audit trail for staff actions and notification history

### Administration

- Daily, weekly, and monthly analytics with configurable anchor date and department filter
- Booking and served trends, hourly demand, priority mix, department and doctor performance
- CSV export of appointment records
- Staff directory, account creation, password changes, and deactivation
- Department/doctor configuration and notification outbox
- Role-based route and API authorization

## Role Matrix

| Capability | Admin | Doctor | Nurse | Receptionist |
| --- | :---: | :---: | :---: | :---: |
| Public booking and tracking | Yes | Yes | Yes | Yes |
| View all queues | Yes | - | Yes | Yes |
| View assigned doctor queue | Yes | Yes | - | - |
| Book / check in / cancel | Yes | - | Yes | Yes |
| Triage priority | Yes | Own patients | Yes | - |
| Call / start / complete / skip / recall | Yes | Own queue | - | - |
| Pause / resume queue | Yes | Own queue | - | - |
| Send alerts | Yes | Own patients | Yes | Yes |
| Analytics and CSV export | Yes | - | - | - |
| Staff and access management | Yes | - | - | - |

## Main Routes

### Web

| Route | Purpose |
| --- | --- |
| `/` | Patient access hub and saved tokens |
| `/book` | Patient booking and appointments |
| `/track` | Token lookup and saved tokens |
| `/track/:code` | Live token tracking |
| `/display` | Full-screen public queue display |
| `/staff/login` | Staff sign-in |
| `/staff/analytics` | Admin analytics |
| `/staff/queues` | Live overview of all queues |
| `/staff/frontdesk` | Registration, check-in, triage, ticket search |
| `/staff/queue` | Doctor queue controls; admins can select a doctor |
| `/staff/team` | Staff accounts, permissions, roster |

### API highlights

- `POST /api/public/bookings`
- `GET /api/public/tickets/:code`
- `POST /api/public/tickets/:code/check-in`
- `POST /api/public/tickets/:code/cancel`
- `GET /api/public/board`
- `POST /api/auth/login`
- `GET /api/staff/queue?doctorId=...`
- `POST /api/staff/doctors/:doctorId/call-next`
- `POST /api/staff/appointments/:id/start`
- `POST /api/staff/appointments/:id/complete`
- `POST /api/staff/doctors/:doctorId/pause`
- `GET /api/admin/analytics?period=daily|weekly|monthly`
- `GET /api/admin/export?period=daily`
- `GET /api/admin/staff`

## Configuration

Copy `apps/api/.env.example` to `apps/api/.env` and adjust values as needed.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | API and production web port |
| `DB_PATH` | `apps/api/data/sqms.db` | SQLite database path |
| `JWT_SECRET` | Development secret | Change for any non-demo deployment |
| `PUBLIC_APP_URL` | `http://localhost:5173` | Base URL used in notification tracking links |
| `TWILIO_ACCOUNT_SID` | unset | Enables real SMS when all Twilio values are set |
| `TWILIO_AUTH_TOKEN` | unset | Twilio auth token |
| `TWILIO_FROM_NUMBER` | unset | Twilio sender number |
| `TWILIO_DEFAULT_COUNTRY_CODE` | `+91` | Country code applied to local mobile numbers |

Without Twilio credentials, SMS messages are recorded in the notification outbox with a simulated status. In-app and browser voice alerts still work.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API and Vite web app together |
| `npm run dev:api` | Run only the API with watch mode |
| `npm run dev:web` | Run only the Vite web app |
| `npm run build` | Build the React app |
| `npm start` | Start the API and serve the built web app |
| `npm run reset-db --workspace=@sqms/api` | Delete and reseed the demo database |

## Project Layout

```text
apps/
  api/
    src/
      server.js         Express routes, Socket.IO, static hosting
      db.js             SQLite schema and demo seed data
      auth.js           JWT authentication and role guards
      queueService.js   Queue ordering, positions, and ETA calculations
      notifications.js  Multilingual message templates and delivery
      analytics.js      KPI, trend, performance, and export queries
      utils.js          Shared priority/date/phone helpers
  web/
    src/
      pages/            Patient, display, and staff screens
      components/       Shared UI and staff shell
      context/          Auth, language, and toast providers
      lib/              API, socket, voice, and formatting helpers
      styles.css        Application design system and responsive layouts
```

## Notes

- Token order is recalculated after priority changes, check-ins, skips, recalls, and queue pause/resume.
- Queue updates are pushed over Socket.IO and the public display also refreshes periodically as a fallback.
- The database uses WAL mode. Back up `sqms.db` before deploying with production data.
- This project is a complete demo implementation. Before production use, replace demo credentials, set a strong `JWT_SECRET`, configure HTTPS, and connect a production SMS provider.
