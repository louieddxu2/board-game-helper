import { useSiteMode } from '../hooks/useSiteMode';
import { AddPage } from './AddPage';
import { UncertainAddPage } from './UncertainAddPage';

/** /add records a wrong rule, or in the uncertain mode an uncertain one; the URL stays the same. */
export const AddRoute = () => useSiteMode().mode === 'uncertain' ? <UncertainAddPage /> : <AddPage />;
