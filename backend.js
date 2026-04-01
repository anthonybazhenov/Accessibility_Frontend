// Consolidated backend helpers and feature glue (keeps visuals from main but restores backend behavior)
(function () {
    // Re-use API_BASE and storage helpers from config.js which is expected to be loaded first.
    function cfg_getStoredJwt() { return window.getStoredJwt && window.getStoredJwt(); }
    function cfg_setStoredJwt(t) { if (window.setStoredJwt) window.setStoredJwt(t); }
    function cfg_clearStoredJwt() { if (window.clearStoredJwt) window.clearStoredJwt(); }
    function cfg_authHeaders() { return window.authHeaders ? window.authHeaders() : {}; }
    function cfg_consumeJwtFromUrlHash() { if (window.consumeJwtFromUrlHash) window.consumeJwtFromUrlHash(); }

    // Expose wrappers so pages can call the helpers (don't overwrite if present)
    window.getStoredJwt = window.getStoredJwt || cfg_getStoredJwt;
    window.setStoredJwt = window.setStoredJwt || cfg_setStoredJwt;
    window.clearStoredJwt = window.clearStoredJwt || cfg_clearStoredJwt;
    window.authHeaders = window.authHeaders || cfg_authHeaders;
    window.consumeJwtFromUrlHash = window.consumeJwtFromUrlHash || cfg_consumeJwtFromUrlHash;

    // IndexedDB helpers (used by dashboard and viewer)
    var DB_NAME = 'ASL_Documents';
    var STORE_NAME = 'documents';
    var VIEWER_STORE = 'viewer';

    function openDB() {
        return new Promise(function (resolve, reject) {
            var r = indexedDB.open(DB_NAME, 2);
            r.onerror = function () { reject(r.error); };
            r.onsuccess = function () { resolve(r.result); };
            r.onupgradeneeded = function () {
                var db = r.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                if (!db.objectStoreNames.contains(VIEWER_STORE)) db.createObjectStore(VIEWER_STORE, { keyPath: 'id' });
            };
        });
    }

    function setViewerDoc(name, blob) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(VIEWER_STORE, 'readwrite');
                tx.objectStore(VIEWER_STORE).put({ id: 'current', name: name, blob: blob });
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function saveDocToDB(id, name, size, dateStr, blob) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.put({ id: id, name: name, size: size, dateAdded: dateStr, blob: blob });
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function deleteDocFromDB(id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).delete(id);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function loadDocsFromDB() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var req = tx.objectStore(STORE_NAME).getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    // Small utilities
    function formatSize(size) { return size < 1024 ? size + ' B' : size < 1024 * 1024 ? (size / 1024).toFixed(1) + ' KB' : (size / (1024 * 1024)).toFixed(1) + ' MB'; }
    function formatDate(now) { return (now.getMonth() + 1) + '/' + now.getDate() + '/' + String(now.getFullYear()).slice(-2) + ' ' + (now.getHours() % 12 || 12) + ':' + String(now.getMinutes()).padStart(2, '0') + (now.getHours() >= 12 ? 'pm' : 'am'); }
    function formatServerTimestamp(ts) {
        if (!ts) return formatDate(new Date());
        if (typeof ts === 'string') { var d = new Date(ts); return isNaN(d.getTime()) ? formatDate(new Date()) : formatDate(d); }
        if (Array.isArray(ts) && ts.length >= 3) { var mo = ts[1]; if (mo > 0 && mo <= 12) mo -= 1; var d2 = new Date(ts[0], mo, ts[2], ts[3] || 0, ts[4] || 0, ts[5] || 0); return formatDate(d2); }
        return formatDate(new Date());
    }

    function displayStatusFromApi(status) {
        if (!status) return { text: '—', nonCompliant: false };
        if (status === 'FAILED') return { text: 'Failed', nonCompliant: true };
        if (status === 'NEEDS_REVIEW') return { text: 'Needs review', nonCompliant: true };
        if (status === 'REMEDIATED') return { text: 'Remediated', nonCompliant: false };
        if (status === 'REMEDIATED_WITH_WARNINGS') return { text: 'Remediated (warnings)', nonCompliant: false };
        return { text: String(status).replace(/_/g, ' '), nonCompliant: false };
    }

    // Document table helpers (dashboard)
    function escapeHtml(s) { var div = document.createElement('div'); div.textContent = s; return div.innerHTML; }

    function getComplianceStatus(name) { if (!name) return 'Compliant'; return /sample2|non[- ]?compliant|fail/i.test(name) ? 'Non-Compliant' : 'Compliant'; }

    // These functions will be attached to window if not present so page scripts can call them
    window.openDB = window.openDB || openDB;
    window.setViewerDoc = window.setViewerDoc || setViewerDoc;
    window.saveDocToDB = window.saveDocToDB || saveDocToDB;
    window.deleteDocFromDB = window.deleteDocFromDB || deleteDocFromDB;
    window.loadDocsFromDB = window.loadDocsFromDB || loadDocsFromDB;
    window.formatSize = window.formatSize || formatSize;
    window.formatDate = window.formatDate || formatDate;
    window.getComplianceStatus = window.getComplianceStatus || getComplianceStatus;

    // Dashboard: dynamic table management and server integration
    function wireDashboard() {
        var fileInput = document.getElementById('fileUpload');
        var addBtn = document.getElementById('addDocBtn');
        var tbody = document.getElementById('documentsBody');
        var selectAll = document.getElementById('selectAll');
        if (!fileInput || !addBtn || !tbody) return;

        var nextDocId = 0;
        var idToFile = {};

        function updateSelectAllState() {
            if (!selectAll || !tbody) return;
            var checkboxes = tbody.querySelectorAll('.doc-checkbox');
            var checked = tbody.querySelectorAll('.doc-checkbox:checked');
            var total = checkboxes.length;
            var selected = checked.length;
            if (total === 0) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
                return;
            }
            selectAll.checked = selected === total;
            selectAll.indeterminate = selected > 0 && selected < total;
        }

        function addLocalRow(id, name, sizeStr, dateStr, blobOrFile) {
            idToFile[id] = blobOrFile;
            var tr = document.createElement('tr');
            tr.setAttribute('data-doc-id', id);
            tr.setAttribute('data-server', '0');
            var status = getComplianceStatus(name);
            var statusClass = status === 'Non-Compliant' ? ' is-non-compliant' : '';
            tr.innerHTML = '<td class="td-select"><input type="checkbox" class="doc-checkbox" aria-label="Select row"></td><td><a href="#" class="doc-open-link" data-doc-id="' + id + '" data-server="0" aria-label="Open document">' + escapeHtml(name) + '</a></td><td>' + dateStr + '</td><td>' + sizeStr + '</td><td><span class="doc-status-badge' + statusClass + '">' + status + '</span> <span class="doc-local-hint" title="Not sent to the backend">(browser only)</span></td>';
            tr.setAttribute('title', 'This file is stored only in your browser, not on the server. Set API_BASE in config.js and upload while logged in to send PDFs to the backend.');
            tbody.appendChild(tr);
            updateSelectAllState();
        }

        function addServerRow(doc) {
            var id = doc.id;
            var name = doc.originalFilename || 'Document';
            var dateStr = formatServerTimestamp(doc.timestamp);
            var disp = displayStatusFromApi(doc.status);
            var statusClass = disp.nonCompliant ? ' is-non-compliant' : '';
            var tr = document.createElement('tr');
            tr.setAttribute('data-doc-id', id);
            tr.setAttribute('data-server', '1');
            tr.innerHTML = '<td class="td-select"><input type="checkbox" class="doc-checkbox" aria-label="Select row"></td><td><a href="#" class="doc-open-link" data-doc-id="' + id + '" data-server="1" aria-label="Open document">' + escapeHtml(name) + '</a></td><td>' + dateStr + '</td><td>—</td><td><span class="doc-status-badge' + statusClass + '">' + escapeHtml(disp.text) + '</span></td>';
            tbody.appendChild(tr);
            updateSelectAllState();
        }

        function clearTable() { tbody.innerHTML = ''; idToFile = {}; }

        function setUploadStatus(message, success) {
            var el = document.getElementById('uploadStatus');
            if (!el) return;
            if (!message) { el.textContent = ''; el.hidden = true; el.className = 'upload-status-msg'; return; }
            el.textContent = message; el.hidden = false; el.className = 'upload-status-msg' + (success === false ? ' is-error' : ' is-success');
        }

        function apiReady() { return typeof API_BASE !== 'undefined' && API_BASE && API_BASE !== 'https://your-backend-url'; }

        window.refreshDocumentTable = window.refreshDocumentTable || function () {
            if (!apiReady()) return Promise.resolve([]);
            return fetch(API_BASE + '/alteredDocuments', { credentials: 'include', headers: (typeof authHeaders === 'function' ? authHeaders() : {}) })
                .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
                .then(function (list) { clearTable(); nextDocId = 0; list.forEach(function (doc) { addServerRow(doc); }); return list; })
                .catch(function (err) { console.error('Could not load documents from server:', err); return []; });
        };

        // Load either server list or local DB
        if (apiReady()) {
            window.refreshDocumentTable().catch(function (err) { console.error('Could not load documents from server:', err); });
        } else {
            loadDocsFromDB().then(function (docs) { docs.forEach(function (d) { if (d.id >= nextDocId) nextDocId = d.id + 1; addLocalRow(d.id, d.name, formatSize(d.size), d.dateAdded, d.blob); }); }).catch(function (err) { console.error('Could not load saved documents:', err); });
        }

        if (selectAll) {
            selectAll.addEventListener('change', function () {
                var check = this.checked;
                tbody.querySelectorAll('.doc-checkbox').forEach(function (cb) { cb.checked = check; });
                updateSelectAllState();
            });
        }
        tbody.addEventListener('change', function (e) {
            if (e.target && e.target.classList.contains('doc-checkbox')) updateSelectAllState();
        });

        addBtn.addEventListener('click', function () { if (addBtn.getAttribute('aria-busy') === 'true') return; fileInput.click(); });

        fileInput.addEventListener('change', function () {
            var files = fileInput.files; if (!files.length) return; setUploadStatus('');

            function uploadPdfToBackend(file) {
                var fd = new FormData(); fd.append('file', file, file.name);
                var auth = typeof authHeaders === 'function' ? authHeaders() : {};
                var headers = {};
                if (auth['Authorization']) headers['Authorization'] = auth['Authorization'];
                return fetch(API_BASE + '/inputDocuments', { method: 'POST', credentials: 'include', headers: headers, body: fd })
                    .then(function (res) {
                        var ct = (res.headers.get('content-type') || '').toLowerCase();
                        var parseBody = ct.indexOf('application/json') !== -1 ? res.json() : res.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return { error: t || ('HTTP ' + res.status) }; } });
                        return parseBody.then(function (body) { if (!res.ok) { var msg = (body && body.error) ? body.error : ('HTTP ' + res.status); throw new Error(msg); } return body; });
                    });
            }

            function processOne(i) {
                if (i >= files.length) { fileInput.value = ''; addBtn.disabled = false; addBtn.setAttribute('aria-busy', 'false'); return; }
                var f = files[i]; var lower = (f.name || '').toLowerCase(); if (!lower.endsWith('.pdf')) { alert('Only PDF files are sent to the accessibility service. Skipped: ' + f.name); processOne(i + 1); return; }
                if (typeof getStoredJwt === 'function' && getStoredJwt() && !apiReady()) { alert('Backend URL is not set. Open config.js and set API_BASE to your Spring server, then reload this page. Your file was not sent to the server.'); processOne(i + 1); return; }

                if (apiReady()) {
                    addBtn.disabled = true; addBtn.setAttribute('aria-busy', 'true');
                    uploadPdfToBackend(f).then(function (body) {
                        return window.refreshDocumentTable().then(function (list) {
                            if (body && body.documentId != null && list && !list.some(function (d) { return String(d.id) === String(body.documentId); })) {
                                addServerRow({ id: body.documentId, originalFilename: body.filename || f.name, status: body.status, timestamp: new Date().toISOString() });
                            }
                            var label = body.filename || f.name || 'file';
                            var st = body.status ? ' — ' + String(body.status).replace(/_/g, ' ') : '';
                            setUploadStatus('Successfully uploaded: ' + label + st + '.', true);
                        });
                    }).then(function () { processOne(i + 1); }).catch(function (err) { var msg = err && err.message ? err.message : String(err); setUploadStatus('Upload failed: ' + msg, false); alert('Upload failed: ' + msg); processOne(i + 1); });
                } else {
                    var id = nextDocId++; var name = f.name; var sizeStr = formatSize(f.size); var dateStr = formatDate(new Date()); addLocalRow(id, name, sizeStr, dateStr, f); setUploadStatus('Saved in this browser: ' + name + ' (not sent to the server).', true); saveDocToDB(id, name, f.size, dateStr, f).catch(function (e) { console.error('Could not save document to storage:', e); }); processOne(i + 1);
                }
            }

            processOne(0);
        });

        tbody.addEventListener('click', function (e) {
            var link = e.target.closest('.doc-open-link'); if (!link) return; e.preventDefault(); var server = link.getAttribute('data-server') === '1'; var id = parseInt(link.getAttribute('data-doc-id'), 10); if (server) { window.location.href = 'document.html?id=' + encodeURIComponent(id); return; } var file = idToFile[id]; if (!file) return; setViewerDoc(file.name, file).then(function () { window.location.href = 'document.html'; }).catch(function (err) { console.error('Could not open document:', err); });
        });

        // Delete action: local rows → IndexedDB; server rows → DELETE /alteredDocuments/{id} then remove row
        var deleteBtn = document.getElementById('deleteDocBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                var toRemove = [];
                tbody.querySelectorAll('tr').forEach(function (tr) {
                    var cb = tr.querySelector('.doc-checkbox');
                    if (cb && cb.checked) toRemove.push(tr);
                });
                if (!toRemove.length) return;

                var localRows = [];
                var serverRows = [];
                toRemove.forEach(function (tr) {
                    if (tr.getAttribute('data-server') === '1') {
                        serverRows.push(tr);
                    } else {
                        localRows.push(tr);
                    }
                });

                function removeLocalRow(tr) {
                    var id = tr.getAttribute('data-doc-id');
                    if (id != null) {
                        var numId = parseInt(id, 10);
                        delete idToFile[numId];
                        deleteDocFromDB(numId).catch(function (e) {
                            console.error('Could not remove document from storage:', e);
                        });
                    }
                    tr.remove();
                }

                localRows.forEach(removeLocalRow);
                updateSelectAllState();

                if (!serverRows.length) {
                    return;
                }

                if (!apiReady()) {
                    alert('Cannot delete server documents: set API_BASE in config.js and reload.');
                    return;
                }

                var auth = typeof authHeaders === 'function' ? authHeaders() : {};
                var headers = {};
                if (auth['Authorization']) headers['Authorization'] = auth['Authorization'];

                deleteBtn.disabled = true;
                deleteBtn.setAttribute('aria-busy', 'true');

                Promise.all(
                    serverRows.map(function (tr) {
                        var id = tr.getAttribute('data-doc-id');
                        return fetch(API_BASE + '/alteredDocuments/' + encodeURIComponent(id), {
                            method: 'DELETE',
                            credentials: 'include',
                            headers: headers
                        }).then(function (res) {
                            if (res.ok || res.status === 404) {
                                tr.remove();
                                return;
                            }
                            return res.text().then(function (t) {
                                throw new Error(t || 'HTTP ' + res.status);
                            });
                        });
                    })
                )
                    .then(function () {
                        updateSelectAllState();
                    })
                    .catch(function (err) {
                        var msg = err && err.message ? err.message : String(err);
                        alert('Could not delete one or more documents: ' + msg);
                    })
                    .finally(function () {
                        deleteBtn.disabled = false;
                        deleteBtn.removeAttribute('aria-busy');
                        updateSelectAllState();
                    });
            });
        }
    }

    // Document viewer: server fetch, sidebar population, downloads
    function wireDocumentViewer() {
        var params = new URLSearchParams(window.location.search);
        var serverId = params.get('id');
        var placeholder = document.getElementById('placeholder');
        var frame = document.getElementById('docFrame');
        var titleEl = document.getElementById('docTitle');
        var statusEl = document.getElementById('docStatus');
        var alterationsList = document.getElementById('alterationsList');
        var aiIssues = document.getElementById('aiIssues');
        var manualIssues = document.getElementById('manualIssues');

        function apiReadyLocal() { return typeof API_BASE !== 'undefined' && API_BASE && API_BASE !== 'https://your-backend-url'; }

        function parseFilenameFromContentDisposition(header) {
            if (!header) return null; var star = /filename\*=UTF-8''([^;\n]+)/i.exec(header); if (star) { try { return decodeURIComponent(star[1].trim()); } catch (e) { return star[1].trim(); } } var m = /filename="([^"]+)"/i.exec(header); if (m) return m[1]; m = /filename=([^;\n]+)/i.exec(header); if (m) return m[1].replace(/^"|"$/g, '').trim(); return null;
        }

        function downloadRemediated(format, docId) {
            var h = typeof authHeaders === 'function' ? authHeaders() : {};
            if (!h['Authorization']) {
                alert('Sign in to download.');
                return;
            }
            var url = API_BASE + '/alteredDocuments/' + encodeURIComponent(docId) + '/download?format=' + encodeURIComponent(format);
            fetch(url, { credentials: 'include', headers: h })
                .then(function (res) {
                    if (!res.ok) throw new Error('Download failed');
                    var cd = res.headers.get('Content-Disposition');
                    var name = parseFilenameFromContentDisposition(cd) || ('document.' + (format === 'pdf' ? 'pdf' : 'html'));
                    return res.blob().then(function (blob) {
                        return { blob: blob, filename: name };
                    });
                })
                .then(function (o) {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(o.blob);
                    a.download = o.filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                })
                .catch(function () {
                    alert('Could not download ' + (format === 'pdf' ? 'PDF' : 'HTML') + '.');
                });
        }

        function wireDownloadButtons(docId, report) {
            var btnHtml = document.getElementById('downloadHtmlBtn');
            var btnPdf = document.getElementById('downloadPdfBtn');
            if (btnHtml) btnHtml.onclick = function () { downloadRemediated('html', docId); };
            if (btnPdf) { var hasPdf = report && report.remediated_pdf_available; btnPdf.disabled = !hasPdf; btnPdf.title = hasPdf ? 'Download remediated PDF' : 'Remediated PDF is not generated for this document yet'; btnPdf.onclick = function () { if (!btnPdf.disabled) downloadRemediated('pdf', docId); }; }
        }

        function showServerViewerChrome() {
            var dlActions = document.getElementById('serverDownloadActions');
            var vHint = document.getElementById('viewerHint');
            if (dlActions) dlActions.hidden = false;
            if (vHint) vHint.hidden = false;
        }

        function issueLineText(issue) {
            var text = (issue.issue || issue.evidence || '').trim();
            var sc = issue.success_criteria || issue.successCriteria;
            if (sc) text += (text ? ' — ' : '') + sc;
            var p = issue.page_number != null ? issue.page_number : issue.pageNumber;
            if (p != null) text += (text ? ' ' : '') + '(page ' + p + ')';
            return text || '—';
        }

        function populateAlterations(report) {
            if (!alterationsList) return;
            alterationsList.innerHTML = '';
            var lines = report && report.alterations && report.alterations.length ? report.alterations : [];
            if (!lines.length) {
                var li0 = document.createElement('li');
                li0.className = 'issue-item alteration-item';
                li0.textContent = 'No alteration summary is available for this document.';
                alterationsList.appendChild(li0);
                return;
            }
            lines.forEach(function (line) {
                var li = document.createElement('li');
                li.className = 'issue-item alteration-item';
                li.textContent = line;
                alterationsList.appendChild(li);
            });
        }

        function populateReportSidebar(report) {
            if (!aiIssues || !manualIssues) return;
            aiIssues.innerHTML = '';
            manualIssues.innerHTML = '';
            populateAlterations(report);

            if (!report || !report.issues || !report.issues.length) {
                aiIssues.innerHTML = '<li class="issue-item">No warnings or notes.</li>';
                manualIssues.innerHTML = '<li class="issue-item">No outstanding issues.</li>';
                return;
            }

            report.issues.forEach(function (issue) {
                var li = document.createElement('li');
                li.className = 'issue-item';
                var sev = (issue.severity || '').toLowerCase();
                if (sev === 'error') {
                    li.classList.add('issue-severity-error');
                } else if (sev === 'warning') {
                    li.classList.add('issue-severity-warning');
                } else if (sev === 'info') {
                    li.classList.add('issue-severity-info');
                }
                li.textContent = issueLineText(issue);
                if (sev === 'error') {
                    manualIssues.appendChild(li);
                } else {
                    aiIssues.appendChild(li);
                }
            });

            if (!manualIssues.children.length) {
                manualIssues.innerHTML = '<li class="issue-item">No outstanding issues.</li>';
            }
            if (!aiIssues.children.length) {
                aiIssues.innerHTML = '<li class="issue-item">No warnings or notes.</li>';
            }
        }

        function loadFromServer(docId) {
            var h = typeof authHeaders === 'function' ? authHeaders() : {};
            if (!h['Authorization']) {
                if (placeholder) placeholder.textContent = 'Sign in to view this document.';
                wireDownloadButtons(docId, null);
                return;
            }
            var base = API_BASE + '/alteredDocuments/' + encodeURIComponent(docId);
            Promise.all([
                fetch(base + '/download?format=html', { credentials: 'include', headers: h }).then(function (res) {
                    if (!res.ok) throw new Error('Could not load document');
                    return res.blob();
                }),
                fetch(base + '/report', { credentials: 'include', headers: h }).then(function (res) {
                    if (!res.ok) return null;
                    return res.json();
                })
            ])
                .then(function (results) {
                    var blob = results[0];
                    var report = results[1];
                    var objectUrl = URL.createObjectURL(blob);
                    if (frame) frame.src = objectUrl;
                    if (frame) frame.style.display = 'block';
                    if (placeholder) placeholder.style.display = 'none';
                    if (titleEl && report && report.filename) titleEl.textContent = report.filename;
                    else if (titleEl) titleEl.textContent = 'Document';
                    if (statusEl) {
                        var label = 'Remediated';
                        var bad = false;
                        if (report) {
                            if (report.errors > 0) {
                                label = 'Needs review';
                                bad = true;
                            } else if (report.warnings > 0) {
                                label = 'Remediated (warnings)';
                            }
                        }
                        statusEl.textContent = 'Status: ' + label;
                        statusEl.classList.toggle('is-non-compliant', bad);
                    }
                    populateReportSidebar(report);
                    wireDownloadButtons(docId, report);
                })
                .catch(function () {
                    if (placeholder) placeholder.textContent = 'Could not load document from server.';
                    wireDownloadButtons(docId, null);
                });
        }

        if (serverId && apiReadyLocal()) {
            showServerViewerChrome();
            loadFromServer(serverId);
        }
        /* Local blob viewer when there is no ?id= is handled in document.html (avoids racing server load). */
    }

    // Login/Register wiring (kept from earlier)
    function wireLogin(formId, opts) {
        opts = opts || {};
        var form = document.getElementById(formId);
        if (!form) return;
        var submitBtn = form.querySelector('button[type="submit"]');
        var errorEl = document.getElementById(opts.errorId || 'loginFormError') || document.getElementById(opts.errorId || 'loginError');

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var username = document.getElementById('username').value.trim();
            var password = document.getElementById('password').value;
            if (!username || !password) { showError('Please enter both username and password'); return; }
            if (!API_BASE || API_BASE === 'https://your-backend-url') { showError('Configure API_BASE in config.js'); return; }

            setLoading(true); hideError();
            fetch(API_BASE + '/authenticate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username: username, password: password }) })
                .then(function (res) {
                    if (!res.ok) return res.text().then(function (text) { throw new Error(text || 'Login failed'); });
                    var hdrToken = res.headers.get('X-JWT-Token') || res.headers.get('x-jwt-token');
                    function finishLogin(token) { if (!token) { setLoading(false); showError('Login succeeded on the server but the browser did not receive a token. Hard-refresh and try again.'); return; } setStoredJwt(token); window.location.href = 'test.html#asl_token=' + encodeURIComponent(token); }
                    return res.clone().json().then(function (data) { var token = hdrToken || (data && (data.token || data.access_token)); finishLogin(token); }).catch(function () { return res.text().then(function (text) { var token = hdrToken; try { var data = JSON.parse(text); if (data && data.token) token = data.token; } catch (e) {} var m = text && text.match(/"token"\s*:\s*"([^"]+)"/); if (m) token = m[1]; finishLogin(token); }); });
                })
                .catch(function (err) {
                    setLoading(false);
                    if (err && err.message && (err.message.toLowerCase().indexOf('invalid') !== -1 || err.message.indexOf('credentials') !== -1)) { showError('Invalid username or password'); }
                    else if (err && err.message && (err.message.toLowerCase().indexOf('fetch') !== -1 || err.message.toLowerCase().indexOf('load') !== -1 || err.message === 'Failed to fetch')) { showError('Cannot reach server. Check config.js and that the backend is running at ' + API_BASE + '.'); }
                    else { showError('Login failed. Please try again.'); }
                });

            function setLoading(loading) { if (submitBtn) { submitBtn.disabled = loading; submitBtn.textContent = loading ? 'Logging in…' : 'Login'; } }
            function showError(msg) { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } }
            function hideError() { if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; } }
        });
    }

    function wireRegister(formId, opts) {
        opts = opts || {};
        var form = document.getElementById(formId);
        if (!form) return;
        var submitBtn = form.querySelector('button[type="submit"]');
        var errorEl = document.getElementById(opts.errorId || 'registerError');

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var password = document.getElementById('password').value;
            var confirmPassword = document.getElementById('confirmPassword').value;
            if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
            if (!API_BASE || API_BASE === 'https://your-backend-url') { showError('Configure API_BASE in config.js'); return; }
            var name = document.getElementById('name').value.trim();
            var email = document.getElementById('email').value.trim();
            var username = document.getElementById('username').value.trim();
            var dobInput = document.getElementById('dob').value;
            if (!name || !email || !username || !password || !dobInput) { showError('Please fill in all fields.'); return; }
            var dobParts = dobInput.split('-'); var dobStr = dobParts[1] + '-' + dobParts[2] + '-' + dobParts[0];
            setLoading(true); hideError();
            var params = new URLSearchParams({ email: email, password: password, name: name, username: username, dob: dobStr });
            fetch(API_BASE + '/api/person/post?' + params.toString(), { method: 'POST', credentials: 'include' })
                .then(function (res) { if (res.ok) { window.location.href = 'index.html'; } else { return res.text().then(function (text) { throw new Error(text || 'Registration failed'); }); } })
                .catch(function (err) { setLoading(false); var msg = err && err.message ? err.message : ''; if (msg.toLowerCase().indexOf('fetch') !== -1 || msg.toLowerCase().indexOf('load') !== -1 || msg === 'Failed to fetch') { showError('Cannot reach server. Is the backend running at ' + API_BASE + '? Check config.js.'); } else { showError(msg || 'Registration failed. Please try again.'); } });

            function setLoading(loading) { if (submitBtn) { submitBtn.disabled = loading; submitBtn.textContent = loading ? 'Creating account…' : 'Create account'; } }
            function showError(msg) { if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; } }
            function hideError() { if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; } }
        });
    }

    // Auto-wire known forms and pages
    function init() {
        // Login/register
        if (document.getElementById('loginForm')) wireLogin('loginForm');
        if (document.getElementById('registerForm')) wireRegister('registerForm');
        // Dashboard
        if (document.getElementById('fileUpload') && document.getElementById('documentsBody')) wireDashboard();
        // Document viewer
        if (document.getElementById('docFrame') || document.getElementById('placeholder')) wireDocumentViewer();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
