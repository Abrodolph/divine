import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppDataProvider } from './context/AppDataContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import RecordManager from './components/RecordManager';
import { Loading, Card, EmptyState } from './components/ui';
import { moduleByKey } from './config/modules';
import * as F from './config/fields';

import Dashboard from './modules/Dashboard';
import Attendance from './modules/Attendance';
import Indents from './modules/Indents';
import Challans from './modules/Challans';
import SitePhotos from './modules/SitePhotos';
import Sites from './modules/Sites';
import Team from './modules/Team';
import Advances from './modules/Advances';
import AttendanceRegister from './modules/AttendanceRegister';
import Admin from './modules/Admin';

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
  if (!profile) {
    return (
      <Card className="m-6 p-6">
        <EmptyState
          label="Your account has no profile yet."
          hint="Ask the Admin to open Admin Control and give you a role, then sign in again."
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
          <Route path="indents" element={<Guard k="indents"><Indents /></Guard>} />
          <Route path="challans" element={<Guard k="challans"><Challans /></Guard>} />
          <Route path="site_photos" element={<Guard k="site_photos"><SitePhotos /></Guard>} />
          <Route path="sites" element={<Guard k="sites"><Sites /></Guard>} />
          <Route path="team" element={<Guard k="team"><Team /></Guard>} />
          <Route path="advances" element={<Guard k="advances"><Advances /></Guard>} />
          <Route path="payroll" element={<Navigate to="/team" replace />} />
          <Route path="attendance_register" element={<Guard k="attendance_register"><AttendanceRegister /></Guard>} />

          {/* Config-driven log modules */}
          <Route path="dpr" element={
            <Guard k="dpr">
              <RecordManager module={moduleByKey('dpr')} table="dpr"
                title="Daily Progress Report" subtitle="What happened on site today"
                fields={F.DPR.fields} columns={F.DPR.columns} />
            </Guard>
          } />
          <Route path="requirements" element={
            <Guard k="requirements">
              <RecordManager module={moduleByKey('requirements')} table="requirements"
                title="Site Requirements" subtitle="What site needs from the office"
                fields={F.REQUIREMENTS.fields} columns={F.REQUIREMENTS.columns} />
            </Guard>
          } />
          <Route path="material_received" element={
            <Guard k="material_received">
              <RecordManager module={moduleByKey('material_received')} table="material_received"
                title="Material Received" subtitle="Incoming material with photo proof"
                fields={F.MATERIAL_RECEIVED.fields} columns={F.MATERIAL_RECEIVED.columns} />
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
