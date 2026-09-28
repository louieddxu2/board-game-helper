import { Layout } from './Layout';
import { SessionProvider } from '../context/SessionContext';

export const SiteLayout = () => <SessionProvider><Layout /></SessionProvider>;
