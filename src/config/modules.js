import {
  Home, Users2, FileText, ClipboardList, Camera, Images,
  FileCheck2, Truck, ScrollText, PenTool, RotateCcw, Building2,
  Users, Wallet, ShieldCheck, CalendarCheck,
} from 'lucide-react';
import { THEME } from '../lib/theme';

/**
 * One source of truth for navigation, permissions and the admin screens.
 * `key` matches BOTH the permission key in roles.permissions (database)
 * and the route path — keep them identical when adding a module.
 */
export const MODULES = [
  { key: 'attendance',        label: 'Attendance',        short: 'Attendance', icon: Users2,       accent: THEME.orange, group: 'Site' },
  { key: 'dpr',               label: 'Daily Progress',    short: 'DPR',        icon: FileText,     accent: THEME.green,  group: 'Site' },
  { key: 'requirements',      label: 'Site Requirements', short: 'Requirements', icon: ClipboardList, accent: THEME.amber, group: 'Site' },
  { key: 'site_photos',       label: 'Work Photos',       short: 'Photos',     icon: Images,       accent: THEME.blue,   group: 'Site' },
  { key: 'rework',            label: 'Rework Log',        short: 'Rework',     icon: RotateCcw,    accent: THEME.red,    group: 'Site' },

  { key: 'material_received', label: 'Material Received', short: 'Received',   icon: Camera,       accent: THEME.blue,   group: 'Material' },
  { key: 'challans',          label: 'Delivery Challan',  short: 'Challans',   icon: FileCheck2,   accent: THEME.green,  group: 'Material' },
  { key: 'transport',         label: 'Transport',         short: 'Transport',  icon: Truck,        accent: THEME.orange, group: 'Material' },
  { key: 'mtc',               label: 'Test Certificates', short: 'MTC',        icon: ScrollText,   accent: THEME.green,  group: 'Material' },
  { key: 'drawings',          label: 'Drawing Records',   short: 'Drawings',   icon: PenTool,      accent: THEME.blue,   group: 'Material' },

  { key: 'sites',             label: 'Sites',             short: 'Sites',      icon: Building2,    accent: THEME.blue,   group: 'Setup' },
  { key: 'team',              label: 'Team',              short: 'Team',       icon: Users,        accent: THEME.blue,   group: 'Setup' },
  { key: 'advances',          label: 'Weekly Advance',    short: 'Advances',   icon: Wallet,       accent: THEME.amber,  group: 'Money' },
  { key: 'attendance_register', label: 'Attendance Register', short: 'Register', icon: CalendarCheck, accent: THEME.blue, group: 'Money' },
];

export const DASHBOARD = { key: 'dashboard', label: 'Dashboard', icon: Home, accent: THEME.orange };
export const ADMIN = { key: 'admin', label: 'Admin Control', icon: ShieldCheck, accent: THEME.red };

export const GROUPS = ['Site', 'Material', 'Setup', 'Money'];

export const moduleByKey = (key) => MODULES.find((m) => m.key === key);

/* ------------------------- permission helpers ---------------------------- */

export function canView(role, key) {
  if (!role) return false;
  if (role.is_admin) return true;
  const p = role.permissions?.[key];
  return p === 'edit' || p === 'view';
}

export function canEdit(role, key, locks = {}) {
  if (!role) return false;
  if (role.is_admin) return true;
  return role.permissions?.[key] === 'edit' && !locks[key];
}
