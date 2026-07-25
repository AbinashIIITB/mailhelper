import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mail Helper - personalized bulk email from your Gmail",
  description:
    "Send each recipient their own personalized email from your Gmail. Free mail-merge for small orgs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
