# BookNook Backend

An Express.js API for BookNook. Uses MongoDB Atlas and Better Auth for email/password login, optional Google OAuth, and authenticated CRUD/borrow operations.

## API endpoints

Public: `GET /`, `GET /api/health`, `GET /api/books`.

Better Auth: `/api/auth/*`.

Protected (Bearer JWT): `GET /api/books/:id`, `POST /api/books`, `GET /api/my-books`, `PATCH /api/books/:id`, `DELETE /api/books/:id`, `POST /api/borrows`, `GET /api/my-borrows`, `PATCH /api/borrows/:id/return`.

A signed short-lived JWT can be obtained from `GET /api/session/token` only with a valid Better Auth session cookie.

## Local development

Install `express`, `mongodb`, `cors`, `dotenv`, `jsonwebtoken`, `better-auth`, `@better-auth/mongo-adapter`, and `nodemon` (development). Add `"type": "module"` in package.json. The provided root setup guide contains exact Windows commands.

Copy `.env.example` to `.env` and fill in **your own** credentials. Never commit `.env`.

Run `npm run dev` to serve on port 5000. After MongoDB connects, run `npm run seed` to insert six sample books.

**Note:** If your MongoDB Atlas connection still reports a TLS handshake error, authentication and CRUD will not function until that connection is fixed.
