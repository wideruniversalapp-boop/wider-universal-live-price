import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAdmin } from './lib/auth';
import Catalog from './pages/Catalog';
import ProductPage from './pages/ProductPage';
import ContactPage from './pages/ContactPage';
import QuotePage from './pages/QuotePage';
import NotFound from './pages/NotFound';

const AdminLogin = lazy(() => import('./pages/admin/Login'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const ProductList = lazy(() => import('./pages/admin/ProductList'));
const ProductEdit = lazy(() => import('./pages/admin/ProductEdit'));
const Taxonomy = lazy(() => import('./pages/admin/Taxonomy'));
const ImportExport = lazy(() => import('./pages/admin/ImportExport'));
const PriceListAdmin = lazy(() => import('./pages/admin/PriceListAdmin'));
const History = lazy(() => import('./pages/admin/History'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const ContactsAdmin = lazy(() => import('./pages/admin/ContactsAdmin'));

export default function App() {
  return (
    <Suspense fallback={<div className="page-state">Loading…</div>}>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/quote" element={<QuotePage />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="products" element={<ProductList />} />
          <Route path="products/new" element={<ProductEdit />} />
          <Route path="products/:id" element={<ProductEdit />} />
          <Route path="taxonomy" element={<Taxonomy />} />
          <Route path="import" element={<ImportExport />} />
          <Route path="price-list" element={<PriceListAdmin />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="contacts" element={<ContactsAdmin />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
