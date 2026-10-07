import { useWorkspacePage } from '../workspace/useWorkspacePage';
import { WorkspacePageView } from '../workspace/WorkspacePageView';

export const WorkspacePage = () => {
  const view = useWorkspacePage();
  return <WorkspacePageView {...view} />;
};
