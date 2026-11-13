import { usePageTitle } from '../hooks/usePageTitle';
import { AttributesPageView } from './AttributesPageView';
import { useAttributesPage } from './useAttributesPage';

export const AttributesPage = () => {
  usePageTitle('桌遊屬性投票');
  const view = useAttributesPage();
  return <AttributesPageView {...view} />;
};
