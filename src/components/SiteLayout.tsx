import { Layout } from './Layout';
import { RoleGrantNotice } from './RoleGrantNotice';
import { SessionProvider } from '../context/SessionContext';

export const SiteLayout = () => <SessionProvider><Layout /><RoleGrantNotice /></SessionProvider>;
