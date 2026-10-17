import "./globals.css";
import Script from "next/script";

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
      <body>
        <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
        {children}
      </body>
    </html>
  );
}
