import { AttributesPageView } from './AttributesPageView';
import { useAttributesPage } from './useAttributesPage';

export const AttributesPage = () => {
  const view = useAttributesPage();
  return <AttributesPageView {...view} />;
};
