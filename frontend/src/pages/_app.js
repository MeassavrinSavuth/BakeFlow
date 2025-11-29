import "@/styles/globals.css";
import { NotificationProvider } from '../contexts/NotificationContext';
import { LanguageProvider } from '../contexts/LanguageContext';

export default function App({ Component, pageProps }) {
  return (
    <NotificationProvider>
      <LanguageProvider>
        <Component {...pageProps} />
      </LanguageProvider>
    </NotificationProvider>
  );
}
