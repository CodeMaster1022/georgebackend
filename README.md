# Mars Learning Backend (Express + MongoDB)

## Setup

1. Create your env file:

Copy `backend/.env.example` to `backend/.env` and fill in values:

- `MONGO_URI`
- `JWT_SECRET`
- `CORS_ORIGIN`

2. Install dependencies:

```bash
cd backend
npm install
```

3. Run the server:

```bash
npm run dev
```

The API will run at `https://georgebackend-2.onrender.com` by default.

## API (current)

- `GET /health`

### Auth
- `POST /auth/register` body: `{ role, email, password }`
- `POST /auth/login` body: `{ email, password }`

### Teachers (public)
- `GET /teachers`

### Sessions (public)
- `GET /sessions?teacherId=&status=&from=&to=`

### Credits (student JWT required)
- `GET /credits/balance`
- `GET /credits/ledger`

### Bookings (student JWT required)
- `POST /bookings` body: `{ sessionId }` (books + spends credits, in a transaction)
- `POST /bookings/:id/cancel` (cancels + refunds credits, in a transaction)

## Dev notes (seeding)

This backend uses a **credit ledger** (`creditTransactions`). For development you can seed credits by inserting documents directly in MongoDB:

Example credit top-up (purchase) transaction:

- collection: `credittransactions`
- doc:

```json
{
  "userId": "<STUDENT_USER_OBJECT_ID>",
  "type": "purchase",
  "amount": 10,
  "currency": "credits",
  "related": {},
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

To create a bookable class slot, insert into `classsessions`:

```json
{
  "teacherId": "<TEACHER_PROFILE_OBJECT_ID>",
  "startAt": "2026-01-01T15:00:00.000Z",
  "endAt": "2026-01-01T15:25:00.000Z",
  "status": "open",
  "priceCredits": 1,
  "meetingLink": "https://meet.example.com/abc"
}
```

