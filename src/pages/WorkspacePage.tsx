import { usePageTitle } from '../hooks/usePageTitle';
import { useWorkspacePage } from '../workspace/useWorkspacePage';
import { WorkspacePageView } from '../workspace/WorkspacePageView';

export const WorkspacePage = () => {
  usePageTitle('動態表格');
  const view = useWorkspacePage();
  return <WorkspacePageView {...view} />;
};
