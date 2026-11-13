# BookNook Server

Express + MongoDB API for **BookNook – A Small Online Library**.

Live Link Client and main front-end: https://a08-booknook-project-client.vercel.app

Live link server side :https://a08-booknook-project-server.vercel.app

Client side github repo link : https://github.com/Habib1127/A08-Booknook-project-client

## Features
- 8 REST routes for books and borrows
- JWT validation: tokens issued by BetterAuth (Next.js client) are verified against its JWKS endpoint
- Owner-only update and delete for books
- `copies` tracked with atomic `$inc` (borrow -1, return +1); borrowing is blocked at 0 copies
- No double borrow: checked in code and enforced by a unique MongoDB index
- Newest-first sorting with `?sort=latest&limit=6` for the New Arrivals section

## Routes
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /books | public (`?mine=true` needs JWT) | all books, supports `sort`, `limit`, `category`, `search` |
| GET | /books/:id | JWT | one book |
| POST | /books | JWT | add a book |
| PATCH | /books/:id | JWT (owner) | update a book |
| DELETE | /books/:id | JWT (owner) | delete a book |
| POST | /borrows | JWT | borrow a book |
| GET | /borrows | JWT | borrows of the logged in user |
| DELETE | /borrows/:id | JWT (owner) | return a book |

## Setup
```bash
npm install
cp .env.example .env   # fill in MONGODB_URI, CLIENT_URL, CLIENT_ORIGINS
npm run dev
npm run seed           # optional starter books
```

`CLIENT_URL` must point at the running Next.js client, because the server fetches `CLIENT_URL/api/auth/jwks` to verify tokens.

## Deploy (Vercel)
`vercel.json` is included. Add the same env vars in the Vercel project settings.
