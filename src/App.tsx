import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionProvider } from './context/SessionContext';
import { AddPage } from './pages/AddPage';
import { AdminPage } from './pages/AdminPage';
import { GamePage } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

const router = createBrowserRouter([
  { path: '/', element: <Layout />, children: [
    { index: true, element: <HomePage /> },
    { path: 'add', element: <AddPage /> },
    { path: 'games/:identifier', element: <GamePage /> },
    { path: 'login', element: <LoginPage /> },
    { path: 'admin', element: <AdminPage /> },
  ] },
]);

export const App = () => <SessionProvider><RouterProvider router={router} /></SessionProvider>;

