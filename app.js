/* eslint-disable no-restricted-globals */
/* eslint-disable radix */
/* eslint-disable no-use-before-define */
/* eslint-disable no-undef */
const API_BASE = 'https://armorplated-thersa-unstained.ngrok-free.dev';
const STORAGE_KEY = 'novel_history_v3';
const SETTINGS_KEY = 'novel_settings_v3';
const PROGRESS_KEY = 'novel_progress_v3';
const TRANS_OPTIONS_KEY = 'novel_trans_opts_v1';

const appState = {
	screen: 'home',
	book: null,
	chapter: null,
	scrollPos: 0,
	activeChapterId: null,
	nextChapterId: null,
	prevChapterId: null,
	isLoading: false,
	errorType: 'spelling',
	settings: {
		fontSize: 18, fontFamily: '\'Merriweather\', serif', lazyLoad: true, groupLines: 1, wordSpacing: 0, isEnabledReplaceToggle: false
	},
	// Translation cache
	allBooksCache: null,
	currentBookChaptersCache: null,
	activeTranslateTab: 'current', // 'current' | 'batch_chapter' | 'story'
	pendingTranslation: null,
	pendingChaptersList: [], // Store pending chapters IDs
	currentChapterList: [], // Store all chapters of current page (original order)
	filterState: 'all', // NEW: Store filter state
	sortOption: 'num_asc', // NEW: Store sort option
	editingWordId: null // To track editing item
};
let observer;

window.onload = () => {
	loadSettings();
	loadTranslationOptions(); // Load saved translation options
	handleInitialRoute();

	// Search Debounce
	let timer;
	document.getElementById('searchInput').addEventListener('input', (e) => {
		clearTimeout(timer);
		timer = setTimeout(() => fetchBooks(1, e.target.value), 600);
	});

	window.onscroll = onScroll;
	window.onpopstate = handleInitialRoute;

	observer = new IntersectionObserver(handleIntersect, { root: null, rootMargin: '-10% 0px -80% 0px', threshold: 0 });

	// Selection Logic
	document.addEventListener('selectionchange', debounce(handleTextSelection, 100));
	// iOS Selection Fix
	document.addEventListener('touchend', () => setTimeout(handleTextSelection, 100));
};

function debounce(func, wait) {
	let timeout;
	return function (...args) {
		clearTimeout(timeout);
		timeout = setTimeout(() => func.apply(this, args), wait);
	};
}

const saveReadProgress = debounce((cid, offset) => {
	try {
		const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
		progress[cid] = Math.max(0, Math.floor(offset));
		const keys = Object.keys(progress);
		if (keys.length > 50) delete progress[keys[0]];
		localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
	} catch (e) { }
}, 300);

/* --- ROUTING --- */
function handleInitialRoute() {
	const params = new URLSearchParams(window.location.search);
	const view = params.get('view') || 'home';

	if (view === 'home') {
		setScreen('home', false);
		fetchBooks();
	} else if (view === 'chapters') {
		const bid = params.get('bookId');
		const bname = params.get('bookName');
		if (bid) fetchChapters(bid, bname || 'Mục lục', 1, false);
	} else if (view === 'reader') {
		const cid = params.get('chapterId');
		const bid = params.get('bookId');
		if (cid) {
			appState.book = { id: bid, name: params.get('bookName') || '' };
			setupReader(cid, false);
		}
	}
}

function pushState(view, params = {}) {
	try {
		const url = new URL(window.location);
		url.searchParams.set('view', view);
		Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
		window.history.pushState({}, '', url);
	} catch (e) { }
}

/* --- NAVIGATION --- */
function setScreen(name, updateHistory = true) {
	if (appState.screen !== name && appState.screen !== 'home') {
		if (name === 'home') {
			window.location.href = window.location.pathname;
			return;
		}
	}

	['screen-home', 'screen-chapters', 'screen-reader'].forEach((id) => document.getElementById(id).classList.add('hidden'));
	appState.screen = name;

	const header = document.getElementById('mainHeader');
	const dock = document.getElementById('glassDock');
	const backBtn = document.getElementById('backBtn');
	const title = document.getElementById('pageTitle');
	const settingsBtn = document.getElementById('headerSettingsBtn');

	if (name === 'home') {
		document.getElementById('screen-home').classList.remove('hidden');
		title.innerText = 'NovelReader';
		backBtn.classList.add('hidden');
		settingsBtn.classList.add('hidden');
		appState.book = null;
		dock.classList.remove('hide');
		if (updateHistory) pushState('home');
		fetchBooks();
	} else if (name === 'chapters') {
		document.getElementById('screen-chapters').classList.remove('hidden');
		backBtn.classList.remove('hidden');
		settingsBtn.classList.add('hidden');
		title.innerText = appState.book?.name || 'Mục lục';
		dock.classList.add('hide');
	} else if (name === 'reader') {
		document.getElementById('screen-reader').classList.remove('hidden');
		backBtn.classList.remove('hidden');
		settingsBtn.classList.remove('hidden');
		dock.classList.remove('hide');
	}

	updateDockState();
	window.scrollTo(0, 0);
}

function handleBack() {
	if (appState.screen === 'reader') {
		if (appState.book && appState.book.id) fetchChapters(appState.book.id, appState.book.name);
		else try { window.history.back(); } catch (e) { setScreen('home'); }
	} else {
		setScreen('home');
	}
}

function updateDockState() {
	const isReader = appState.screen === 'reader';
	['btnPrev', 'btnNext', 'btnReport'].forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.classList.toggle('disabled', !isReader);
	});
}

/* --- DATA FETCHING --- */
async function fetchBooks(page = 1, q = '') {
	const el = document.getElementById('bookList');
	el.innerHTML = '<div style="text-align:center; padding:2rem; color:#888;">Đang tải...</div>';
	const pageNum = parseInt(page) || 1;
	const data = await api(`/api/books?page=${pageNum}&limit=100&search=${encodeURIComponent(q)}`);

	if (!data || !data.data.length) { el.innerHTML = '<div style="text-align:center; padding:2rem;">Không tìm thấy truyện.</div>'; return; }
	if (data.pagination) data.pagination.currentPage = pageNum;
	el.innerHTML = data.data.map((b) => `
        <a href="?view=chapters&bookId=${b.bookId}&bookName=${encodeURIComponent(b.bookName)}" target="_blank" style="display: block; text-decoration: none;">
            <div class="book-row">
                <div class="book-icon">${b.bookName.charAt(0)}</div>
                <div class="book-info">
                    <div class="book-title">${b.bookName}</div>
                    <div class="book-meta">
                        <span class="tag"> Tổng: ${b.chapterCount || 0} - Đã dịch: ${b.totalTranslated || 0} - Chưa dịch: ${b.totalPending || 0}</span>
                        <span style="padding: 0px 4px">   ${b.createdAt || 'Đang cập nhật'}  </span> 
                    </div>
                </div>
            </div>
        </a>
    `).join('');
	renderPager('homePagination', data.pagination, (p) => fetchBooks(p, q));
}

async function fetchChapters(bid, bname, page = 1, updateHistory = true) {
	document.title = `${bname} - Mục lục`;
	if (appState.screen === 'reader') {
		const url = new URL(window.location);
		url.searchParams.set('view', 'chapters');
		url.searchParams.set('bookId', bid);
		url.searchParams.set('bookName', bname);
		window.location.href = url.toString();
		return;
	}

	appState.book = { id: bid, name: bname };
	setScreen('chapters', false);
	if (updateHistory) pushState('chapters', { bookId: bid, bookName: bname });

	const el = document.getElementById('chapterList');
	const batchBar = document.getElementById('batchActionBar');
	const segAll = document.getElementById('seg-all');
	const segPending = document.getElementById('seg-pending');

	el.innerHTML = '<div style="padding:2rem; text-align:center;">Đang tải danh sách...</div>';

	const pageNum = parseInt(page) || 1;

	// Build Query Params for Server-Side Filtering & Sorting
	let sortBy = 'chapterNumber';
	let sortOrder = 'ASC';

	if (appState.sortOption === 'num_desc') sortOrder = 'DESC';
	else if (appState.sortOption === 'time_new') { sortBy = 'updatedAt'; sortOrder = 'DESC'; } else if (appState.sortOption === 'time_old') { sortBy = 'updatedAt'; sortOrder = 'ASC'; }

	let filterParam = '';

	// Update UI State for Filter
	if (appState.filterState === 'pending') {
		filterParam = '&state=PENDING';
		batchBar.classList.remove('hidden');
		segPending.classList.add('active', 'pending');
		segAll.classList.remove('active');
	} else {
		batchBar.classList.add('hidden');
		segAll.classList.add('active');
		segPending.classList.remove('active', 'pending');
	}

	const limit = 500; // Reduce limit for faster loading since we use server pagination
	const url = `/api/books/${bid}/chapters?page=${pageNum}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}${filterParam}`;

	const data = await api(url);

	if (!data || !data.chapters.length) {
		el.innerHTML = '<div style="padding:2rem; text-align:center;">Không tìm thấy chương nào.</div>';
		// Reset pagination if empty
		renderPager('chapterPagination', { totalPages: 0, currentPage: 1 }, null);
		renderPager('chapterPagination2', { totalPages: 0, currentPage: 1 }, null);
		return;
	}
	if (data.pagination) data.pagination.currentPage = pageNum;

	appState.currentChapterList = data.chapters;

	// Render directly
	el.innerHTML = data.chapters.map((c) => renderChapterRow(c)).join('');

	renderPager('chapterPagination', data.pagination, (p) => fetchChapters(bid, bname, p, false));
	renderPager('chapterPagination2', data.pagination, (p) => fetchChapters(bid, bname, p, false));
}

// --- Filtering & Sorting Logic (Triggered by UI) ---
function applyFilters() {
	// Read Sort Option from Select
	appState.sortOption = document.getElementById('sortOption').value;

	// Reload Chapters
	if (appState.book && appState.book.id) {
		fetchChapters(appState.book.id, appState.book.name, 1, false);
	}
}

// New function to switch filter state from Segmented Control
function setFilterState(state) {
	if (appState.filterState === state) return; // No change
	appState.filterState = state;
	applyFilters();
}

// --- Render Row Helper ---
function renderChapterRow(c) {
	const isPending = c.state === 'PENDING';
	return `
        <div class="chapter-row ${isPending ? 'pending-row' : ''}" onclick="setupReader('${c.chapterId}')">
            <div>
                <div class="ch-title">${c.title}</div>
                <div class="ch-sub">
                    <span>Chương ${c.chapterNumber}</span>
                    ${isPending ? '<span class="badge-pending">CHỜ DỊCH</span>' : ''}
                </div>
            </div>
            <div style="color:var(--accent); font-weight:bold;">›</div>
        </div>
    `;
}

// --- Handle Manage Pending Click ---
async function handleManagePending() {
	// 1. Open Translation Sheet
	openSheet('translationSheet');

	// 2. Switch to Batch Chapter Tab
	switchTransTab('batch_chapter');

	// 3. No need to load anything initially, user will choose
}

async function setupReader(cid, updateHistory = true) {
	if (appState.screen === 'chapters' && updateHistory) {
		const url = new URL(window.location);
		url.searchParams.set('view', 'reader');
		url.searchParams.set('chapterId', cid);
		url.searchParams.set('bookId', appState.book?.id || '');
		// url.searchParams.set('bookName', appState.book?.name || '');
		window.location.href = url.toString();
		return;
	}

	setScreen('reader', false);
	if (updateHistory) pushState('reader', { chapterId: cid, bookId: appState.book?.id, bookName: appState.book?.name });

	document.getElementById('readerContainer').innerHTML = '';
	appState.isLoading = false;
	await fetchAndRenderChapter(cid, true);
	preloadMenu();
}

async function fetchAndRenderChapter(cid, isInitial = false, forceReload = false) {
	document.title = `${appState.book?.name}` || 'NovelReader';
	if (forceReload) {
		const url = new URL(window.location);
		url.searchParams.set('chapterId', cid);
		window.location.href = url.toString();
		return;
	}

	if (appState.isLoading) return;
	appState.isLoading = true;
	if (!isInitial) document.getElementById('loadingNext').classList.remove('hidden');

	const data = await api(`/api/chapters/${cid}/?groupLines=${appState.settings.groupLines}&isEnabledReplace=${appState.settings.isEnabledReplaceToggle ?? false}`);
	appState.isLoading = false;
	document.getElementById('loadingNext').classList.add('hidden');

	if (!data) return;

	const div = document.createElement('div');
	div.className = 'chapter-block fade-in';
	div.id = `chap-${cid}`;
	div.dataset.cid = cid;
	div.dataset.num = data.chapter.chapterNumber;
	div.dataset.bookName = data.chapter.bookName;

	const content = data.chapter.content.filter((t) => t.trim()).map((t) => `${t}`).join('');
	const header = isInitial
		? `<div aria-hidden="true" style="text-align:center; margin-bottom:1rem;">
            <h5 style="font-family:'Merriweather'; color:var(--accent); margin-bottom:0.2rem;">${data.chapter.title}</h5>
         </div>`
		: `<div class="chapter-header-compact">Chương ${data.chapter.chapterNumber}: ${data.chapter.title}</div>`;

	div.innerHTML = `${header}<article class="reader-text">${content}</article>`;
	document.getElementById('readerContainer').appendChild(div);

	if (isInitial) {
		appState.activeChapterId = cid;
		appState.chapterName = data.chapter.title;
		appState.prevChapterId = data.navigation?.prev?.chapterId;
		updateHeader(data.chapter);
		restoreReadProgress(cid);
	}
	appState.nextChapterId = data.navigation?.next?.chapterId;
	observer.observe(div);
}

function restoreReadProgress(cid) {
	try {
		const progress = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
		const savedOffset = progress[cid];
		if (typeof savedOffset === 'number' && savedOffset > 0) {
			const el = document.getElementById(`chap-${cid}`);
			if (el) setTimeout(() => { window.scrollTo({ top: el.offsetTop + savedOffset, behavior: 'auto' }); }, 100);
		} else {
			window.scrollTo(0, 0);
		}
	} catch (e) { window.scrollTo(0, 0); }
}

/* --- UI LOGIC --- */
function onScroll() {
	const y = window.scrollY;
	if (appState.screen === 'reader') {
		const totalH = document.documentElement.scrollHeight - window.innerHeight;
		document.getElementById('readProgress').style.width = `${totalH > 0 ? (y / totalH) * 100 : 0}%`;
		const scrollingDown = y > appState.scrollPos;
		const hideUI = scrollingDown && y > 100;

		document.getElementById('glassDock').classList.toggle('hide', hideUI);
		document.getElementById('mainHeader').classList.toggle('hide', hideUI);

		if (appState.settings.lazyLoad && !appState.isLoading && appState.nextChapterId && (totalH - y < 1500)) {
			fetchAndRenderChapter(appState.nextChapterId);
		}

		if (appState.activeChapterId) {
			const el = document.getElementById(`chap-${appState.activeChapterId}`);
			if (el) saveReadProgress(appState.activeChapterId, y - el.offsetTop);
		}
	} else {
		document.getElementById('readProgress').style.width = '0';
	}
	appState.scrollPos = y;
}

function handleIntersect(entries) {
	entries.forEach((entry) => {
		if (entry.isIntersecting) {
			const div = entry.target;
			if (appState.activeChapterId !== div.dataset.cid) {
				appState.activeChapterId = div.dataset.cid;
				updateHeader({ bookName: div.dataset.bookName, chapterNumber: div.dataset.num });
				highlightActiveChapter();
				try { const url = new URL(window.location); url.searchParams.set('chapterId', div.dataset.cid); window.history.replaceState({}, '', url); } catch (e) { }

				const container = document.getElementById('readerContainer');
				if (container.children.length > 5) {
					observer.unobserve(container.children[0]);
					container.children[0].remove();
				}
			}
		}
	});
}

function updateHeader(data) {
	document.getElementById('pageTitle').innerText = `C${data.chapterNumber} - ${data.bookName}`;
	if (appState.book) {
		let hist = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
		hist = hist.filter((h) => h.bid !== appState.book.id);
		hist.unshift({
			bid: appState.book.id, bname: appState.book.name, cid: appState.activeChapterId, cnum: data.chapterNumber, scrollPos: 0
		});
		localStorage.setItem(STORAGE_KEY, JSON.stringify(hist.slice(0, 20)));
	}
}

function showToast(msg) {
	const t = document.getElementById('toast');
	t.innerText = msg;
	t.classList.add('show');
	setTimeout(() => t.classList.remove('show'), 3000);
}

/* --- SPELL CHECK / SELECTION --- */
function handleTextSelection() {
	if (appState.screen !== 'reader') return;
	const sel = window.getSelection();
	const tip = document.getElementById('selectionTooltip');
	if (sel.rangeCount > 0 && !sel.isCollapsed) {
		document.querySelector('#glassDock').classList.remove('hide');
	}
	tip.classList.add('hidden');
}

function handleReportClick() {
	// Now opens Edit Word Sheet directly (repurposed)
	openEditWordSheet();
}

// --- NEW: EDIT WORD SHEET LOGIC ---
function openEditWordSheet() {
	// Pre-fill input if text selected
	const sel = window.getSelection();
	const text = sel.rangeCount > 0 ? sel.toString().trim() : '';
	if (text) {
		document.getElementById('wordOriginal').value = text;
	}

	// Clear edit state
	appState.editingWordId = null;
	document.getElementById('wordReplace').value = '';

	openSheet('editWordSheet');
	isEnabledReplaceToggle = appState.settings.isEnabledReplaceToggle ?? false;
	document.getElementById('wordReplaceToggle').checked = isEnabledReplaceToggle;

	loadWordList({ scope: null, search: null });
}

function selectWordScope(scope) {
	document.querySelectorAll('#wordScopeControl .segment-item').forEach((el) => el.classList.remove('active'));
	document.getElementById(`scope-${scope}`).classList.add('active');
	document.getElementById('selectedWordScope').value = scope;
}

function filterWordList() {
	const filter = document.getElementById('wordFilterSelect').value;
	loadWordList({ scope: filter, search: null });
}

let debounceTimer;
function searchWordList() {
	const query = document.getElementById('wordSearchInput').value.trim().toLowerCase();

	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		loadWordList({ search: query });
	}, 500);
}

function toggleWordReplacement(checkbox) {
	appState.settings.isEnabledReplaceToggle = checkbox;
	saveSettings();
	closeAllDrawers();
	setupReader(appState.activeChapterId, true);
	restoreReadProgress(appState.activeChapterId);
}

async function loadWordList({ scope, search } = {}) {
	const container = document.getElementById('wordListContainer');
	const bid = appState.book?.id;
	const cid = appState.activeChapterId;

	if (!bid) { container.innerHTML = '<div style="padding:15px;text-align:center;color:#888;">Chưa mở truyện</div>'; return; }

	// Assuming API endpoint pattern
	try {
		let query = `/api/replacements?bookId=${bid}`;
		if (cid) query += `&chapterId=${cid}`;
		if (scope) query += `&scope=${scope}`;
		if (search) query += `&search=${encodeURIComponent(search)}`;

		const data = await api(query);
		if (data && Array.isArray(data)) {
			renderWordList(data);
		} else {
			container.innerHTML = '<div style="padding:15px;text-align:center;color:#888;">Chưa có từ thay thế nào.</div>';
		}
	} catch (e) {
		container.innerHTML = '<div style="padding:15px;text-align:center;color:#d63031;">Lỗi tải dữ liệu.</div>';
	}
}

function renderWordList(words) {
	const container = document.getElementById('wordListContainer');
	if (words.length === 0) {
		container.innerHTML = '<div style="padding:15px;text-align:center;color:#888;">Chưa có từ thay thế nào.</div>';
		return;
	}

	container.innerHTML = words.map((w) => `
        <div class="word-item" onclick="editWordItem('${w.id}', '${w.original}', '${w.replacement}', '${w.scope}')">
            <div class="word-content">
                <span class="word-orig">${w.original}</span>
                <span class="word-replace">${w.replacement}</span>
            </div>

            <span style="padding: 2px 10px; border-radius: 4px; border-left: 1px solid var(--accent); margin-right: 10px;">${w.scope.slice(0, 1).toUpperCase()}</span>

            <div class="word-actions">
                <button class="icon-action delete" onclick="event.stopPropagation(); deleteWordReplacement('${w.id}')">✕</button>
            </div>
        </div>
        <hr style="margin:0; border:none; border-bottom:1px solid #eee;">
    `).join('');
}

function editWordItem(id, orig, rep, scope) {
	appState.editingWordId = id;
	document.getElementById('wordOriginal').value = orig;
	document.getElementById('wordReplace').value = rep;
	// Map scope if needed, default to what comes back or fallback
	const validScopes = ['chapter', 'book', 'global'];
	const safeScope = validScopes.includes(scope) ? scope : 'book';
	selectWordScope(safeScope);
}

async function saveWordReplacement() {
	const original = document.getElementById('wordOriginal').value.trim();
	const replacement = document.getElementById('wordReplace').value.trim();
	const scope = document.getElementById('selectedWordScope').value;
	const bid = appState.book?.id;
	const cid = appState.activeChapterId;

	if (!original || !replacement) { showToast('Vui lòng nhập đủ thông tin'); return; }
	if (!bid) { showToast('Lỗi: Không xác định được truyện'); return; }

	const payload = {
		original,
		replacement,
		scope,
		bookId: bid,
		chapterId: cid,
		id: appState.editingWordId // If editing
	};

	// Call API
	try {
		// If ID exists -> Update, else Create
		const url = appState.editingWordId ? `/api/replacements/${appState.editingWordId}` : '/api/replacements';
		const method = appState.editingWordId ? 'PUT' : 'POST';

		await fetch(API_BASE + url, {
			method,
			headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
			body: JSON.stringify(payload)
		});

		showToast(appState.editingWordId ? 'Đã cập nhật' : 'Đã thêm từ mới');

		// Clear and Reload
		document.getElementById('wordOriginal').value = '';
		document.getElementById('wordReplace').value = '';
		appState.editingWordId = null;
		loadWordList({ scope: null, search: null });
		setupReader(cid, false);
		restoreReadProgress(cid);
	} catch (e) {
		showToast('Lỗi khi lưu');
	}
}

async function deleteWordReplacement(id) {
	if (!confirm('Xóa từ thay thế này?')) return;
	try {
		await fetch(`${API_BASE}/api/replacements/${id}`, {
			method: 'DELETE',
			headers: { 'ngrok-skip-browser-warning': 'true' }
		});
		showToast('Đã xóa');
		loadWordList({ scope: null, search: null });
		fetchAndRenderChapter(appState.activeChapterId, false, true);
		restoreReadProgress(appState.activeChapterId);
	} catch (e) {
		showToast('Lỗi khi xóa');
	}
}

/* --- TRANSLATION LOGIC (UPDATED) --- */
function handleTranslate() {
	openSheet('translationSheet');
	// Default to 'current' if a book is open, else 'story'
	if (appState.book?.id) {
		switchTransTab('current');
	} else {
		switchTransTab('story');
	}
}

function switchTransTab(tab) {
	appState.activeTranslateTab = tab;
	document.getElementById('tabBtnCurrent').classList.toggle('active', tab === 'current');
	document.getElementById('tabBtnBatchChapter').classList.toggle('active', tab === 'batch_chapter');
	document.getElementById('tabBtnStory').classList.toggle('active', tab === 'story');

	document.getElementById('tabContentCurrent').classList.toggle('hidden', tab !== 'current');
	document.getElementById('tabContentBatchChapter').classList.toggle('hidden', tab !== 'batch_chapter');
	document.getElementById('tabContentStory').classList.toggle('hidden', tab !== 'story');

	// Update main button text
	const btn = document.getElementById('btnSubmitTransSheet');
	btn.innerText = tab === 'current' ? 'Dịch ngay' : 'Tiếp tục';

	if (tab === 'batch_chapter') {
		// Auto load if empty or if book changed
		if (!appState.currentBookChaptersCache || appState.currentBookChaptersCache.bid !== appState.book.id) {
			loadBatchChapters();
		}
	} else if (tab === 'story') {
		loadTranslationBooks();
	} else if (tab === 'current' && appState?.activeChapterId) {
		// No loading needed
		document.getElementById('tabContentCurrentText').innerText = appState.chapterName || 'Chương hiện tại';
	}
}

async function loadTranslationBooks() {
	const listEl = document.getElementById('transBookList');
	if (appState.allBooksCache) {
		renderTranslationBooks(appState.allBooksCache);
		return;
	}
	const data = await api('/api/books?page=1&limit=1000');
	if (data && data.data) {
		appState.allBooksCache = data.data;
		renderTranslationBooks(data.data);
	} else {
		listEl.innerHTML = '<div style="padding:10px;color:#d63031;">Không tải được danh sách truyện</div>';
	}
}

function renderTranslationBooks(books) {
	const listEl = document.getElementById('transBookList');
	if (books.length === 0) {
		listEl.innerHTML = '<div style="padding:10px;color:#888;">Không tìm thấy truyện</div>';
		return;
	}
	listEl.innerHTML = books.map((b) => `
        <label class="book-checkbox-item">
            <input type="checkbox" value="${b.bookId}" data-name="${b.bookName}" name="transBooks">
            <span class="book-checkbox-name" title="${b.bookName}">${b.bookName}</span>
        </label>
    `).join('');
}

function filterTranslationBooks(query) {
	if (!appState.allBooksCache) return;
	const q = query.toLowerCase();
	const filtered = appState.allBooksCache.filter((b) => b.bookName.toLowerCase().includes(q));
	renderTranslationBooks(filtered);
}

// New functions for Chapters Tab
async function loadTranslationChapters() {
	// Only used if needed, currently batch loading is manual
	const listEl = document.getElementById('transChapterList');
	const bid = appState.book.id;

	if (appState.currentBookChaptersCache && appState.currentBookChaptersCache.bid !== bid) {
		appState.currentBookChaptersCache = null;
	}

	if (appState.currentBookChaptersCache) {
		renderTranslationChapters(appState.currentBookChaptersCache.chapters);
		return;
	}

	const data = await api(`/api/books/${bid}/chapters?page=1&limit=10000`);
	if (data && data.chapters) {
		appState.currentBookChaptersCache = { bid, chapters: data.chapters };
		renderTranslationChapters(data.chapters);
	} else {
		listEl.innerHTML = '<div style="padding:10px;color:#d63031;">Không tải được danh sách chương</div>';
	}
}

function renderTranslationChapters(chapters) {
	const listEl = document.getElementById('transChapterList');
	const activeCid = appState.activeChapterId;

	if (chapters.length === 0) {
		listEl.innerHTML = '<div style="padding:10px;color:#888;">Chưa có chương nào</div>';
		return;
	}

	listEl.innerHTML = chapters.map((c) => {
		const isPending = c.state === 'PENDING';
		return `
        <label class="book-checkbox-item">
            <input type="checkbox" value="${c.chapterId}" 
                   data-name="Chương ${c.chapterNumber}" 
                   ${c.chapterId === activeCid ? 'checked' : ''} 
                   name="transChapters" 
                   data-idx="${c.chapterNumber}"
                   data-state="${c.state || 'SUCCEEDED'}">
            <span class="book-checkbox-name" title="${c.title}">Chương ${c.chapterNumber}: ${c.title}</span>
            ${isPending ? '<span class="badge-pending-list">Pending</span>' : ''}
        </label>
    `;
	}).join('');
}

function filterTranslationChapters(query) {
	if (!appState.currentBookChaptersCache) return;
	const q = query.toLowerCase();
	const filtered = appState.currentBookChaptersCache.chapters.filter((c) => c.title.toLowerCase().includes(q) || c.chapterNumber.toString().includes(q));
	renderTranslationChapters(filtered);
}

// --- BATCH LOAD LOGIC (NEW) ---
async function loadBatchChapters() {
	const listEl = document.getElementById('transChapterList');
	const bid = appState.book?.id;
	if (!bid) { showToast('Vui lòng mở một truyện trước.'); return; }

	const mode = document.getElementById('batchLoadMode').value;
	const limit = document.getElementById('batchLoadLimit').value || 50;

	listEl.innerHTML = '<div style="padding:10px;color:#888;text-align:center;">Đang tải dữ liệu...</div>';

	let url = `/api/books/${bid}/chapters?limit=${limit}`;
	if (mode === 'pending') {
		url += '&state=PENDING';
	} else {
		// For 'all', sort by chapter number ascending by default
		url += '&sortBy=chapterNumber&sortOrder=ASC';
	}

	try {
		const data = await api(url);
		if (data && data.chapters) {
			appState.currentBookChaptersCache = { bid, chapters: data.chapters };
			renderTranslationChapters(data.chapters);
			if (data.chapters.length === 0) {
				listEl.innerHTML = '<div style="padding:10px;color:#888;text-align:center;">Không tìm thấy chương nào phù hợp.</div>';
			} else {
				// Auto-select helps user
				toggleBatchSelection(true);
			}
		} else {
			listEl.innerHTML = '<div style="padding:10px;color:#d63031;text-align:center;">Lỗi tải dữ liệu.</div>';
		}
	} catch (e) {
		listEl.innerHTML = '<div style="padding:10px;color:#d63031;text-align:center;">Lỗi kết nối.</div>';
	}
}

function toggleBatchSelection(state) {
	const checkboxes = document.querySelectorAll('#transChapterList input[type="checkbox"]');
	checkboxes.forEach((cb) => cb.checked = state);
}

function selectBatchRange() {
	const start = parseInt(prompt('Từ chương số:', '1'));
	const end = parseInt(prompt('Đến chương số:', ''));

	if (!isNaN(start) && !isNaN(end) && start <= end) {
		const checkboxes = document.querySelectorAll('#transChapterList input[type="checkbox"]');
		let count = 0;
		checkboxes.forEach((cb) => {
			const idx = parseInt(cb.getAttribute('data-idx'));
			if (idx >= start && idx <= end) {
				cb.checked = true;
				count++;
			}
		});
		showToast(`Đã chọn ${count} chương`);
	}
}

// --- CACHE LOGIC ---
function loadTranslationOptions() {
	try {
		const opts = JSON.parse(localStorage.getItem(TRANS_OPTIONS_KEY));
		if (opts) {
			if (opts.model) document.getElementById('aiModelSelect').value = opts.model;
			if (opts.minWords) document.getElementById('transMinWords').value = opts.minWords;
			if (opts.maxWords) document.getElementById('transMaxWords').value = opts.maxWords;
			if (opts.temperature) document.getElementById('transTemperature').value = opts.temperature;
			if (opts.scope !== undefined) document.getElementById('transScopeToggle').checked = opts.scope;
		}
	} catch (e) { console.error('Load opts error', e); }
}

function saveTranslationOptions() {
	const opts = {
		model: document.getElementById('aiModelSelect').value,
		minWords: document.getElementById('transMinWords').value,
		maxWords: document.getElementById('transMaxWords').value,
		temperature: document.getElementById('transTemperature').value,
		scope: document.getElementById('transScopeToggle').checked
	};
	localStorage.setItem(TRANS_OPTIONS_KEY, JSON.stringify(opts));
}

async function submitTranslation() {
	saveTranslationOptions(); // Save options before submitting

	// Gather common data
	const model = document.getElementById('aiModelSelect').value;
	const minW = parseInt(document.getElementById('transMinWords').value) || 100;
	const maxW = parseInt(document.getElementById('transMaxWords').value) || 500;
	const temperature = parseFloat(document.getElementById('transTemperature').value) || 0;
	const isFullScope = document.getElementById('transScopeToggle').checked;
	const mode = appState.activeTranslateTab;

	// --- Case 1: Current Chapter (Instant) ---
	if (mode === 'current') {
		if (!appState.activeChapterId) { showToast('Chưa mở chương nào'); return; }

		const btn = document.getElementById('btnSubmitTransSheet');
		const originalText = btn.innerText;
		btn.innerText = 'Đang xử lý...';
		btn.disabled = true;

		try {
			const payload = {
				temperature,
				model,
				minWords: minW,
				maxWords: maxW,
				retryTranslate: isFullScope,
				mode: 'current',
				bookId: appState.book.id,
				chapterId: [appState.activeChapterId]
			};

			const result = await fetch(`${API_BASE}/stories/gemini-ai/translate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
				body: JSON.stringify(payload)
			}).then((res) => res.json());
			if (result[appState.activeChapterId]?.chapter?.state !== 'SUCCEEDED') {
				throw new Error('Yêu cầu dịch lại đã thất bại.');
			}

			showToast(`Dịch thành công:  ${result[appState.activeChapterId]?.chapter?.totalTokens} tokens`);
			closeAllDrawers();
			setupReader(appState.activeChapterId, false); // Reload content
			// fetchAndRenderChapter(appState.activeChapterId, false, true); // Force reload
		} catch (e) {
			showToast(`Lỗi: ${e.message}`);
			closeAllDrawers();
		} finally {
			btn.innerText = originalText;
			btn.disabled = false;
		}
		return;
	}

	// --- Case 2 & 3: Batch Modes (Require Confirmation) ---
	const selectedIds = [];
	const selectedNames = [];
	let countLabel = '';

	if (mode === 'story') {
		const checkboxes = document.querySelectorAll('input[name="transBooks"]:checked');
		checkboxes.forEach((cb) => {
			selectedIds.push(cb.value);
			selectedNames.push(cb.getAttribute('data-name'));
		});
		if (selectedIds.length === 0) { showToast('Vui lòng chọn ít nhất 1 truyện'); return; }
		countLabel = `${selectedIds.length} truyện`;
	} else // batch_chapter
	{
		if (!appState.book?.id) { showToast('Vui lòng mở truyện trước'); return; }
		const checkboxes = document.querySelectorAll('input[name="transChapters"]:checked');
		checkboxes.forEach((cb) => {
			selectedIds.push(cb.value);
			selectedNames.push(cb.getAttribute('data-name'));
		});
		if (selectedIds.length === 0) { showToast('Vui lòng chọn ít nhất 1 chương'); return; }
		countLabel = `${selectedIds.length} chương`;
	}

	// Prepare Payload for Confirmation
	appState.pendingTranslation = {
		mode,
		model,
		minWords: minW,
		maxWords: maxW,
		retryTranslate: isFullScope,
		ids: selectedIds,
		names: selectedNames, // For display only
		activeBookId: appState.book?.id,
		temperature
	};

	// Show Confirmation
	document.getElementById('confMode').innerText = mode === 'batch_chapter' ? 'Dịch Chương (Batch)' : 'Dịch Truyện (Batch)';
	document.getElementById('confModel').innerText = model;
	document.getElementById('confScope').innerText = isFullScope ? 'Dịch lại toàn bộ' : 'Chỉ dịch phần lỗi/thiếu';
	document.getElementById('confBatch').innerText = `${minW} - ${maxW} từ`;
	document.getElementById('confCount').innerText = countLabel;

	// Populate List
	const listEl = document.getElementById('confList');
	listEl.innerHTML = selectedNames.map((n) => `<div class="confirm-list-item">${n}</div>`).join('');

	closeAllDrawers(); // Close sheet
	document.getElementById('confirmModal').classList.add('show');
}

function closeConfirmModal() {
	document.getElementById('confirmModal').classList.remove('show');
	appState.pendingTranslation = null;
}

async function confirmTranslation() {
	const p = appState.pendingTranslation;
	if (!p) return;

	const btn = document.getElementById('btnRealSubmit');
	btn.innerText = 'Đang gửi...';
	btn.style.opacity = '0.7';

	try {
		const payload = {
			model: p.model,
			minWords: p.minWords,
			maxWords: p.maxWords,
			retryTranslate: p.retryTranslate,
			mode: p.mode,
			currentChapterId: appState.activeChapterId
		};

		if (p.mode === 'batch_chapter') {
			payload.bookId = p.activeBookId;
			payload.chapterId = p.ids;
		} else {
			payload.bookId = p.ids;
		}

		const result = await fetch(`${API_BASE}/stories/gemini-ai/translate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
			body: JSON.stringify(payload)
		});

		showToast('Đã gửi yêu cầu dịch thành công!');

		// Refresh current chapter if it was in the batch
		// if (p.mode === 'batch_chapter' && appState.activeChapterId && p.ids.includes(appState.activeChapterId))
		// {
		//     setTimeout(() => setupReader(appState.activeChapterId, false), 2000);
		// }
	} catch (e) {
		console.error(e);
		showToast('Có lỗi khi gửi yêu cầu');
	} finally {
		btn.innerText = 'Đồng ý';
		btn.style.opacity = '1';
		closeConfirmModal();
	}
}

function openReportSheet() {
	const text = window.getSelection().toString().trim() ?? '';
	document.getElementById('originalText').value = text;
	document.getElementById('newText').value = text;
	document.getElementById('selectionTooltip').classList.add('hidden');
	openSheet('reportSheet');
}

function selectErrorType(el, type) {
	document.querySelectorAll('.chip-group .chip').forEach((c) => c.classList.remove('active'));
	el.classList.add('active');
	appState.errorType = type;
}

async function submitReport() {
	const o = document.getElementById('originalText').value;
	const n = document.getElementById('newText').value;
	const type = appState.errorType;
	const bid = appState.book?.id;

	if (!bid) { showToast('Không tìm thấy ID sách'); return; }
	const btn = document.querySelector('#reportSheet .btn-primary');

	try {
		btn.innerText = 'Đang gửi...';
		const result = await fetch(`${API_BASE}/api/book/update/${bid}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
			body: JSON.stringify({
				originalText: o, newText: n, chapterId: appState.activeChapterId, errorType: type
			})
		}).then((res) => res.json());
		showToast(result.message || 'Báo cáo đã được gửi');
		setupReader(appState.activeChapterId, false);
	} catch (e) { showToast('Lỗi khi gửi báo cáo'); } finally {
		btn.innerText = 'Gửi báo cáo';
		closeAllDrawers();
		window.getSelection().removeAllRanges();
	}
}

/* --- DRAWER / SHEET LOGIC --- */
function toggleDrawer(name) {
	if (name === 'menu') {
		preloadMenu();
		openSheet('menuDrawer');
	} else if (name === 'history') {
		renderHistory();
		openSheet('historyDrawer');
	} else if (name === 'settings') {
		openSheet('settingsSheet');
	}
}

function openSheet(id) {
	document.querySelectorAll('.bottom-sheet.show, .side-drawer.show').forEach((el) => {
		if (el.id !== id) el.classList.remove('show');
	});
	document.getElementById('sheetOverlay').classList.add('show');
	document.getElementById(id).classList.add('show');
}

function closeAllDrawers() {
	document.getElementById('sheetOverlay').classList.remove('show');
	document.querySelectorAll('.bottom-sheet, .side-drawer').forEach((el) => el.classList.remove('show'));
}

/* --- SETTINGS & HELPERS --- */
function loadSettings() {
	try {
		const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
		if (s) appState.settings = { ...appState.settings, ...s };
	} catch { }
	applySettings();
}

function applySettings() {
	const r = document.documentElement;
	r.style.setProperty('--reader-font-size', `${appState.settings.fontSize / 16}rem`);
	r.style.setProperty('--reader-font-family', appState.settings.fontFamily);
	r.style.setProperty('--reader-word-spacing', `${appState.settings.wordSpacing}px`);

	document.getElementById('fontSizeDisplay').innerText = appState.settings.fontSize;
	document.getElementById('wordSpacingDisplay').innerText = appState.settings.wordSpacing;
	document.getElementById('sentenceCountDisplay').innerText = appState.settings.groupLines;

	const tog = document.getElementById('lazyToggleCircle');
	if (tog) tog.style.left = appState.settings.lazyLoad ? '22px' : '2px';
	document.querySelectorAll('[data-font]').forEach((el) => {
		if (el.dataset.font === appState.settings.fontFamily) el.classList.add('active');
		else el.classList.remove('active');
	});
}

function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(appState.settings)); applySettings(); }
function changeFontSize(d) { let s = appState.settings.fontSize + d; if (s < 14) s = 14; if (s > 28) s = 28; appState.settings.fontSize = s; saveSettings(); }
function changeWordSpacing(d) { let s = appState.settings.wordSpacing + d; if (s < 0) s = 0; if (s > 10) s = 10; appState.settings.wordSpacing = s; document.documentElement.style.setProperty('--reader-word-spacing', `${s}px`); saveSettings(); }
function changeSentenceCount(d) { let s = (appState.settings.groupLines ?? 1) + d; if (s < 1) s = 1; if (s > 10) s = 10; appState.settings.groupLines = s; saveSettings(); setupReader(appState.activeChapterId, false); }
function changeFont(el) { appState.settings.fontFamily = el.dataset.font; saveSettings(); }
function toggleLazyLoad(el) { appState.settings.lazyLoad = !appState.settings.lazyLoad; saveSettings(); }

/* --- MENU & PAGINATION --- */
async function preloadMenu() {
	const el = document.getElementById('menuBody');
	if (!appState.book) return;
	if (el.getAttribute('data-bid') === appState.book.id) return highlightActiveChapter();
	el.innerHTML = '<div style="padding:2rem;text-align:center;color:#888;">Đang tải...</div>';
	const data = await api(`/api/books/${appState.book.id}/chapters?page=1&limit=50000`);
	if (data) {
		el.setAttribute('data-bid', appState.book.id);
		el.innerHTML = data.chapters.map((c) => `<div class="drawer-item" id="menu-ch-${c.chapterId}" aria-hidden="true" onclick="closeAllDrawers(); setupReader('${c.chapterId}')">
                <div aria-hidden="true" style="font-weight:600; font-size:0.9rem;">Chương ${c.chapterNumber}</div>
                <div aria-hidden="true" style="font-size:0.85rem; color:#888;">${c.title}</div>
            </div>`).join('');
	}
	highlightActiveChapter();
}

function highlightActiveChapter() {
	if (!appState.activeChapterId) return;
	document.querySelectorAll('.drawer-item.active').forEach((e) => e.classList.remove('active'));
	const el = document.getElementById(`menu-ch-${appState.activeChapterId}`);
	if (el) { el.classList.add('active'); setTimeout(() => el.scrollIntoView({ block: 'center' }), 300); }
}

function renderHistory() {
	const el = document.getElementById('historyBody');
	const hist = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
	el.innerHTML = hist.length ? hist.map((h) => `<div class="drawer-item" aria-hidden="true" onclick="closeAllDrawers(); appState.book={id:'${h.bid}',name:'${h.bname}'}; setupReader('${h.cid}')">
            <div aria-hidden="true" style="font-weight:700; font-size:0.9rem; color:white;">${h.bname}</div>
            <div aria-hidden="true" style="font-size:0.85rem; color:var(--accent);">Đọc tiếp Chương ${h.cnum}</div>
        </div>`).join('') : '<div style="padding:2rem;text-align:center;color:#888;">Chưa có lịch sử.</div>';
}

function clearHistory() {
	if (confirm('Bạn có chắc muốn xóa toàn bộ lịch sử đọc?')) {
		localStorage.removeItem(STORAGE_KEY);
		renderHistory();
		showToast('Đã xóa lịch sử');
	}
}

function renderPager(id, pg, cb) {
	const el = document.getElementById(id);
	if (!pg || pg.totalPages <= 1) { el.innerHTML = ''; return; }
	const c = pg.currentPage || 1;
	const cbName = `pager_cb_${id}`;
	window[cbName] = cb;
	const btnStyle = 'width:36px; height:36px; border-radius:8px; background:#1e293b; color:white; display:flex; align-items:center; justify-content:center; cursor:pointer;';
	el.innerHTML = `
        ${c > 1 ? `<div aria-hidden="true" style="${btnStyle}" onclick="window['${cbName}'](${c - 1})">←</div>` : ''}
        <div aria-hidden="true" style="padding:0 10px; line-height:36px; color:#888; font-size:0.9rem;">Trang ${c}/${pg.totalPages}</div>
        ${c < pg.totalPages ? `<div aria-hidden="true" style="${btnStyle}" onclick="window['${cbName}'](${c + 1})">→</div>` : ''}
    `;
}

function navManual(dir) {
	if (dir === 'prev' && appState.prevChapterId) fetchAndRenderChapter(appState.prevChapterId, false, true);
	else if (dir === 'next' && appState.nextChapterId) {
		const el = document.getElementById(`chap-${appState.nextChapterId}`);
		if (el) el.scrollIntoView({ behavior: 'smooth' });
		else fetchAndRenderChapter(appState.nextChapterId, false, true);
	}
}

async function api(path) {
	try {
		const res = await fetch(API_BASE + path, { headers: { 'ngrok-skip-browser-warning': 'true' } });
		if (!res.ok) throw new Error('Err');
		return await res.json();
	} catch { return null; }
}
