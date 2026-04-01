# Frontend–Backend Integration Instructions

Instructions for connecting the ASL Frontend to the Accessibility Backend, implementing the login system, and wiring the GPT API to the frontend.

---

## 1. Connect the Frontend to the Backend

### Run Both Apps on Different Ports

- **Backend:** Spring Boot runs on port **8085** (from `application.properties`)
- **Frontend:** Static HTML served on a different port (e.g. **4000** or **5500**)

Use the makefile: `make start PORT=4000` (or `PORT=5500`) so the frontend runs on a different port than the backend.

### CORS Configuration

`MvcConfig` already allows `http://localhost:4000`, `http://localhost:5500`, etc.  
`SecurityConfig` hardcodes `Access-Control-Allow-Origin: https://the-gpt-warriors.github.io/`, which can override `MvcConfig` for local dev.

**Action:** For local development, either add your frontend origin (e.g. `http://localhost:4000`) to the `Access-Control-Allow-Origin` header in `SecurityConfig`, or use a CORS config that supports multiple origins (e.g. via `CorsConfigurationSource` bean) so both localhost and GitHub Pages work.

### API Base URL

Define a single base URL in the frontend, e.g.:

```javascript
const API_BASE = 'http://localhost:8085';
```

Use this for all backend requests.

---

## 2. Implement the Login System

### Login (`index.html`)

1. Replace the fake `test`/`test` check with a real API call.
2. Send `POST` to `http://localhost:8085/authenticate` with JSON body:
   ```json
   { "username": "...", "password": "..." }
   ```
3. Use `fetch` with `credentials: 'include'` so the backend's `Set-Cookie` is stored and sent on later requests.
4. On success (e.g. 200), redirect to `test.html`.
5. On failure (e.g. 401), show an error message.

### Registration (`register.html`)

1. Call `POST /api/person/post` with query parameters:
   - `email`, `password`, `name`, `username`, `dob` (format `MM-dd-yyyy`)
2. The backend expects `dob`. Either:
   - Add a date-of-birth field to the form, or
   - Use a default (e.g. `01-01-2000`) for now.
3. Validate that password and confirm password match before sending.
4. On success, redirect to `index.html` (login page).

### JWT Cookie Behavior

- Backend sets an HttpOnly, Secure, SameSite=None cookie named `jwt`.
- `Secure` requires HTTPS. For localhost, many browsers treat it as secure.
- `JwtRequestFilter` reads the `jwt` cookie and authenticates the user.
- All authenticated requests must use `credentials: 'include'` so the cookie is sent.

### Protecting Pages

- On `test.html` and `document.html`, optionally call `GET /api/person/jwt` with `credentials: 'include'`.
- If the response is 401/403, redirect to `index.html`.
- If 200, the user is authenticated; you can show their name from the response.

---

## 3. Make the GPT API Interact with the Frontend

The backend's GPT-based PDF flow is in `chatDocService` and exposed by `chatDocApiController`:

- `POST /inputDocuments` – upload PDF
- `GET /alteredDocuments` – list processed documents
- `GET /alteredDocuments/{id}/report` – accessibility report
- `GET /alteredDocuments/{id}/download?format=html|pdf` – download remediated document

### `test.html` (Documents List)

1. **Upload:** When the user selects a PDF:
   - Build `FormData` with the file under the key `file`.
   - `POST` to `http://localhost:8085/inputDocuments` with `credentials: 'include'`.
   - On success, refresh the document list (or add the new doc to the table).
   - Show a loading/processing state while the backend processes the PDF (GPT alt text, etc.).

2. **List:** On load (and after uploads):
   - `GET http://localhost:8085/alteredDocuments` with `credentials: 'include'`.
   - Render the response in the table (name, date, status, etc.) instead of (or in addition to) IndexedDB.

3. **Open document:** When the user clicks a document:
   - Either navigate to `document.html?id=<documentId>` and load from the backend, or
   - Keep using IndexedDB for local files if you still support that path.

### `document.html` (Document Viewer)

1. **Load from backend:** If the URL has `?id=<documentId>`:
   - `GET http://localhost:8085/alteredDocuments/{id}/report` for the accessibility report.
   - `GET http://localhost:8085/alteredDocuments/{id}/download?format=html` for the accessible HTML.
   - Display the HTML (e.g. in an iframe or by replacing the main content).
   - Use the report to populate the "Tweaked by AI" and "Needs manual tweaking" panels.

2. **Fallback:** If there is no `id`, keep the current IndexedDB-based flow for locally stored documents.

### Backend Configuration

- Set `OPENAI_API_KEY` in the environment (or in `application.properties`) so GPT alt-text generation works.
- Without it, the backend falls back to placeholder alt text.

---

## Summary Checklist

| Task | Where | Action |
|------|-------|--------|
| CORS for localhost | Backend `SecurityConfig` | Add or allow `http://localhost:4000` (and your frontend port) |
| API base URL | Frontend | Define `API_BASE = 'http://localhost:8085'` |
| Login | `index.html` | POST to `/authenticate`, `credentials: 'include'`, redirect on success |
| Register | `register.html` | POST to `/api/person/post` with `email`, `password`, `name`, `username`, `dob` |
| Document upload | `test.html` | POST file to `/inputDocuments` |
| Document list | `test.html` | GET `/alteredDocuments` and render table |
| Document viewer | `document.html` | GET `/alteredDocuments/{id}/report` and `/download?format=html` when `?id=` is present |
| Auth on requests | All API calls | Use `credentials: 'include'` in `fetch` |
| OpenAI key | Backend env | Set `OPENAI_API_KEY` for GPT processing |
