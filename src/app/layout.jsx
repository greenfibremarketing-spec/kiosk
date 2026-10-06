import "./globals.css";

export const metadata = {
  title: "GreenFibre Eco Kitchenware Kiosk",
  description: "Touchscreen kiosk for sustainable eco-friendly kitchenware."
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
