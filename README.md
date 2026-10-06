# GreenFibre kiosk (demo)

Left: avatar panel. Right: product showcase. Next.js 16.3.8, React 19, plain JavaScript.

## Run
    npm install
    npm run dev      # http://localhost:3000
    npm run build && npm start

Use Chrome for voice input. Product names and prices are sample data.

## Structure
    src/app/api/chat      chat endpoint (swap in LangChain here)
    src/components/avatar    AvatarPanel, AvatarFace, Captions, QuickReplies, MicButton
    src/components/products  ProductShowcase, FeaturedProduct, ProductCard, PriceTag, ...
    src/components/kiosk     KioskShell (composes both panels)
    src/hooks             useKiosk (state/actions), useSpeech (voice in/out)
    src/lib, src/data     agent logic, formatting, sample products
    src/styles            tokens, layout, avatar, products

## Next steps
1. LangChain: replace `reply()` in `src/app/api/chat/route.js`; keep the response shape.
2. Real products: replace `src/data/products.js` with your backend call.
3. Real avatar: create the session on the server (LiveAvatar LITE mode), then pass the
   WebRTC `MediaStream` to `<AvatarPanel stream={...} />`. Keys stay in `.env.local`.
