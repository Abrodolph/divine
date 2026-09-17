import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppDataProvider } from './context/AppDataContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import RecordManager from './components/RecordManager';
import { Loading, Card, EmptyState } from './components/ui';
import { moduleByKey } from './config/modules';
import * as F from './config/fields';

// Screens load on first visit, so a supervisor's phone doesn't download payroll and procurement up front.
const Dashboard = lazy(() => import('./modules/Dashboard'));
const Attendance = lazy(() => import('./modules/Attendance'));
const AttendanceVerify = lazy(() => import('./modules/AttendanceVerify'));
const AttendanceRegister = lazy(() => import('./modules/AttendanceRegister'));
const Requests = lazy(() => import('./modules/Requests'));
const Procurement = lazy(() => import('./modules/Procurement'));
const GoodsReceived = lazy(() => import('./modules/GoodsReceived'));
const Challans = lazy(() => import('./modules/Challans'));
const Sites = lazy(() => import('./modules/Sites'));
const Team = lazy(() => import('./modules/Team'));
const TeamArchive = lazy(() => import('./modules/TeamArchive'));
const Payroll = lazy(() => import('./modules/Payroll'));
const Documents = lazy(() => import('./modules/Documents'));
const Advances = lazy(() => import('./modules/Advances'));
const Reports = lazy(() => import('./modules/Reports'));
const Admin = lazy(() => import('./modules/Admin'));

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { session, profile, loading } = useAuth();

  if (loading) return <Loading label="Starting up…" />;
  if (!session) return <Login />;
  if (!profile || profile.active === false) {
    return (
      <Card className="m-6 p-6">
        <EmptyState
          label={profile ? 'Your account has been disabled.' : 'Your account has no profile yet.'}
          hint="Ask the Admin to check your login in Admin Control, then sign in again."
        />
      </Card>
    );
  }

  return (
    <AppDataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />

          {/* Modules with their own workflow */}
          <Route path="attendance" element={<Guard k="attendance"><Attendance /></Guard>} />
          <Route path="attendance_verify" element={<Guard k="attendance_verify"><AttendanceVerify /></Guard>} />
          <Route path="attendance_register" element={<Guard k="attendance_register"><AttendanceRegister /></Guard>} />
          <Route path="requirements" element={<Guard k="requirements"><Requests /></Guard>} />
          <Route path="procurement" element={<Guard k="procurement"><Procurement /></Guard>} />
          <Route path="material_received" element={<Guard k="material_received"><GoodsReceived /></Guard>} />
          <Route path="challans" element={<Guard k="challans"><Challans /></Guard>} />
          <Route path="sites" element={<Guard k="sites"><Sites /></Guard>} />
          <Route path="team" element={<Guard k="team"><Team /></Guard>} />
          <Route path="team/archive" element={<Guard k="team"><TeamArchive /></Guard>} />
          <Route path="payroll" element={<Guard k="payroll"><Payroll /></Guard>} />
          <Route path="documents" element={<Guard k="documents"><Documents /></Guard>} />
          <Route path="advances" element={<Guard k="advances"><Advances /></Guard>} />
          <Route path="reports" element={<Guard k="reports"><Reports /></Guard>} />

          {/* Old links from merged / renamed modules */}
          <Route path="indents" element={<Navigate to="/requirements" replace />} />

          {/* Config-driven log modules */}
          <Route path="dpr" element={
            <Guard k="dpr">
              <RecordManager module={moduleByKey('dpr')} table="dpr"
                title="Daily Progress Report" subtitle="What happened on site today"
                fields={F.DPR.fields} columns={F.DPR.columns} />
            </Guard>
          } />
          <Route path="transport" element={
            <Guard k="transport">
              <RecordManager module={moduleByKey('transport')} table="transport"
                title="Transport" subtitle="Vehicle and driver movement log"
                fields={F.TRANSPORT.fields} columns={F.TRANSPORT.columns} />
            </Guard>
          } />
          <Route path="mtc" element={
            <Guard k="mtc">
              <RecordManager module={moduleByKey('mtc')} table="mtc"
                title="Test Certificates" subtitle="Material test certificates by batch"
                fields={F.MTC.fields} columns={F.MTC.columns} />
            </Guard>
          } />
          <Route path="drawings" element={
            <Guard k="drawings">
              <RecordManager module={moduleByKey('drawings')} table="drawings"
                title="Drawing Records" subtitle="Register of drawings and revisions"
                fields={F.DRAWINGS.fields} columns={F.DRAWINGS.columns} />
            </Guard>
          } />
          <Route path="rework" element={
            <Guard k="rework">
              <RecordManager module={moduleByKey('rework')} table="rework"
                title="Rework Log" subtitle="Quality issues and corrective action"
                fields={F.REWORK.fields} columns={F.REWORK.columns} />
            </Guard>
          } />
          <Route path="items" element={
            <Guard k="items">
              <RecordManager module={moduleByKey('items')} table="items"
                title="Items" subtitle="The catalogue sites pick from when raising a request"
                fields={F.ITEMS.fields} columns={F.ITEMS.columns} filterField={null} orderBy="name" ascending />
            </Guard>
          } />
          <Route path="vendors" element={
            <Guard k="vendors">
              <RecordManager module={moduleByKey('vendors')} table="vendors"
                title="Vendors" subtitle="Suppliers you ask for quotes"
                fields={F.VENDORS.fields} columns={F.VENDORS.columns} filterField={null} orderBy="name" ascending />
            </Guard>
          } />

          <Route path="admin" element={<AdminGuard><Admin /></AdminGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppDataProvider>
  );
}

function Guard({ k, children }) {
  const { canView } = useAuth();
  if (!canView(k)) return <NoAccess />;
  return children;
}

function AdminGuard({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <NoAccess />;
  return children;
}

function NoAccess() {
  return (
    <Card>
      <EmptyState
        label="You don't have access to this section."
        hint="Ask the Admin to update your role permissions."
      />
    </Card>
  );
}
