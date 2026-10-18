// imagePreloader.js — Proactive Image Caching & Instant Decode for Kiosk Catalog

const _preloadedUrls = new Set();

/**
 * Preload and decode an image URL into browser memory.
 */
export function preloadSingleImage(url, priority = "low") {
  if (!url || typeof window === "undefined" || _preloadedUrls.has(url)) return;
  _preloadedUrls.add(url);

  const img = new Image();
  if (priority === "high") {
    img.fetchPriority = "high";
    img.decoding = "sync";
  } else {
    img.fetchPriority = "low";
    img.decoding = "async";
  }
  img.src = url;
  if (typeof img.decode === "function") {
    img.decode().catch(() => {});
  }
}

/**
 * Preloads the primary photo of every product in the catalog during idle periods.
 */
export function preloadCatalogThumbnails(products = []) {
  if (!Array.isArray(products) || products.length === 0 || typeof window === "undefined") return;

  const runPreload = () => {
    products.forEach((p, index) => {
      const url = p.image || p.variants?.[0]?.images?.[0] || p.images?.[0];
      if (url) {
        // Stagger requests slightly to prevent saturation
        setTimeout(() => {
          preloadSingleImage(url, "low");
        }, index * 40);
      }
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(runPreload, { timeout: 3000 });
  } else {
    setTimeout(runPreload, 200);
  }
}

/**
 * Immediately preloads the primary photo and first 2-3 gallery/variant photos
 * of a product being navigated to.
 */
export function preloadProductDetailPhotos(product) {
  if (!product || typeof window === "undefined") return;

  const urls = [];
  if (product.image) urls.push(product.image);
  if (Array.isArray(product.images)) urls.push(...product.images);
  if (Array.isArray(product.variants)) {
    for (const v of product.variants) {
      if (Array.isArray(v.images)) urls.push(...v.images);
      else if (v.image) urls.push(v.image);
    }
  }

  // Preload top 4 images with high priority
  urls.slice(0, 4).forEach((u) => {
    preloadSingleImage(u, "high");
  });
}
