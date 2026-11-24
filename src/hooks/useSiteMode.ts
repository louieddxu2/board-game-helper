import { useSession } from '../context/SessionContext';
import { useStoredSiteMode, writeSiteMode, type SiteMode } from '../lib/siteMode';

/** 不確定的桌遊規則 is admin-only for now, so everyone else always sees the wrong-rules site. */
export const useSiteMode = () => {
  const { isAdmin } = useSession();
  const stored = useStoredSiteMode();
  const mode: SiteMode = isAdmin ? stored : 'wrong';
  return { mode, canSwitch: isAdmin, setMode: writeSiteMode };
};
