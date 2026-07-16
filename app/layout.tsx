import "./globals.css";

export const metadata = {
  title: "CorpSec Client Portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark");}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
