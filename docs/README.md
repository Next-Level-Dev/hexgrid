Copy `.env.example` to `.env` and set `ADMIN_PASSWORD` before starting the server.

Sign in from the header with an operative and password. Administrators sign in with the password from `.env`. For every other account, an admin generates a one-time password reset link in the admin console; the link is valid for 7 days, shows the account identity read-only, and does not create a session. Sessions last 30 days after a successful password login.
