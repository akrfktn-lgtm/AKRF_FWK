import type { Metadata } from "next";
import "./globals.css";
import "./assessment.css";
import "./assessment-topic.css";
import "./auth.css";
import "./ranch-reports.css";
import "./report-details.css";
import "./brand-accessibility.css";
import "./felda-theme.css";
import "./responsive-scale.css";
import "./print-questions.css";

export const metadata: Metadata = {
  title: "AKRF | FELDA Wilayah Kuantan",
  description: "Sistem penilaian dan pemantauan Anugerah Keceriaan Rancangan FELDA Wilayah Kuantan.",
  icons: { icon: "/felda-logo.svg", shortcut: "/felda-logo.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ms">
      <body>{children}</body>
    </html>
  );
}