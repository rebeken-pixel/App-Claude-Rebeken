const form = document.getElementById("search-form");
const titleInput = document.getElementById("title");
const authorInput = document.getElementById("author");
const searchBtn = document.getElementById("search-btn");
const errorMessage = document.getElementById("error-message");
const result = document.getElementById("result");
const coverImg = document.getElementById("cover-img");
const downloadBtn = document.getElementById("download-btn");
const copyBtn = document.getElementById("copy-btn");
const bookTitle = document.getElementById("book-title");
const bookAuthors = document.getElementById("book-authors");
const bookMeta = document.getElementById("book-meta");
const bookSynopsis = document.getElementById("book-synopsis");
const copyFeedback = document.getElementById("copy-feedback");

const PLACEHOLDER_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="100%" height="100%" fill="#e3dccf"/><text x="50%" y="50%" font-family="serif" font-size="16" fill="#6b5f56" text-anchor="middle" dominant-baseline="middle">Sin portada</text></svg>'
  );

let currentCoverUrl = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const author = authorInput.value.trim();

  hideError();
  hideFeedback();

  if (!title && !author) {
    showError("Ingresá al menos el título o el autor del libro.");
    return;
  }

  setLoading(true);
  result.hidden = true;

  try {
    const book = await searchBook(title, author);
    if (!book) {
      showError("No se encontró ningún libro con esos datos. Probá con otro título o autor.");
      return;
    }
    renderBook(book);
  } catch (err) {
    console.error(err);
    showError("Ocurrió un error al buscar el libro. Intentá de nuevo en unos segundos.");
  } finally {
    setLoading(false);
  }
});

async function searchBook(title, author) {
  const terms = [];
  if (title) terms.push(`intitle:${title}`);
  if (author) terms.push(`inauthor:${author}`);
  const query = encodeURIComponent(terms.join("+"));
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Books API respondió con estado ${response.status}`);
  }
  const data = await response.json();
  if (!data.items || data.items.length === 0) {
    return null;
  }
  return data.items[0].volumeInfo;
}

function renderBook(volumeInfo) {
  bookTitle.textContent = volumeInfo.title || "Título desconocido";
  bookAuthors.textContent = volumeInfo.authors ? volumeInfo.authors.join(", ") : "Autor desconocido";

  const metaParts = [];
  if (volumeInfo.publisher) metaParts.push(volumeInfo.publisher);
  if (volumeInfo.publishedDate) metaParts.push(volumeInfo.publishedDate);
  bookMeta.textContent = metaParts.join(" · ");

  bookSynopsis.textContent = volumeInfo.description || "No hay sinopsis disponible para este libro.";

  const imageLinks = volumeInfo.imageLinks || {};
  const coverUrl =
    imageLinks.extraLarge ||
    imageLinks.large ||
    imageLinks.medium ||
    imageLinks.small ||
    imageLinks.thumbnail ||
    imageLinks.smallThumbnail ||
    null;

  currentCoverUrl = coverUrl ? coverUrl.replace(/^http:/, "https:") : null;
  coverImg.src = currentCoverUrl || PLACEHOLDER_COVER;
  coverImg.alt = `Portada de ${volumeInfo.title || "libro"}`;
  downloadBtn.disabled = !currentCoverUrl;

  result.hidden = false;
}

downloadBtn.addEventListener("click", async () => {
  if (!currentCoverUrl) return;
  hideFeedback();

  try {
    const response = await fetch(currentCoverUrl);
    if (!response.ok) throw new Error("No se pudo descargar la imagen");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = buildCoverFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.warn("Descarga directa falló, se abre la imagen en una nueva pestaña.", err);
    window.open(currentCoverUrl, "_blank", "noopener,noreferrer");
    showFeedback("No se pudo descargar automáticamente. Se abrió la portada en otra pestaña: hacé clic derecho y \"Guardar imagen como...\".");
  }
});

copyBtn.addEventListener("click", async () => {
  const text = bookSynopsis.textContent;
  if (!text) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
    showFeedback("Sinopsis copiada al portapapeles ✅");
  } catch (err) {
    console.error(err);
    showFeedback("No se pudo copiar la sinopsis.");
  }
});

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function buildCoverFilename() {
  const rawTitle = bookTitle.textContent || "portada";
  const safeTitle = rawTitle
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${safeTitle || "portada"}.jpg`;
}

function setLoading(isLoading) {
  searchBtn.disabled = isLoading;
  searchBtn.textContent = isLoading ? "Buscando..." : "Buscar";
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function hideError() {
  errorMessage.hidden = true;
}

function showFeedback(message) {
  copyFeedback.textContent = message;
  copyFeedback.hidden = false;
}

function hideFeedback() {
  copyFeedback.hidden = true;
}
