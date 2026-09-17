import {
  Home, Users2, FileText, ClipboardList, PackageCheck, ShoppingCart, Boxes, Store,
  FileCheck2, Truck, ScrollText, PenTool, RotateCcw, Building2, BadgeCheck,
  Users, Wallet, ShieldCheck, CalendarCheck, FolderLock, IdCard, BarChart3, Stamp, Banknote,
} from 'lucide-react';
import { THEME } from '../lib/theme';

/**
 * One source of truth for navigation, permissions and the admin screens.
 * `key` matches BOTH the permission key in roles.permissions (database)
 * and the route path — keep them identical when adding a module.
 *
 * permissionOnly: a permission with no screen of its own (shown in Admin's
 * permission grid, not in the menu).
 */
export const MODULES = [
  { key: 'attendance',          label: 'Attendance',          short: 'Attendance', icon: Users2,        accent: THEME.orange, group: 'Site' },
  { key: 'attendance_verify',   label: 'Verify Attendance',   short: 'Verify',     icon: BadgeCheck,    accent: THEME.green,  group: 'Site' },
  { key: 'dpr',                 label: 'Daily Progress',      short: 'DPR',        icon: FileText,      accent: THEME.green,  group: 'Site' },
  { key: 'requirements',        label: 'Site Requests',       short: 'Requests',   icon: ClipboardList, accent: THEME.amber,  group: 'Site' },
  { key: 'rework',              label: 'Rework Log',          short: 'Rework',     icon: RotateCcw,     accent: THEME.red,    group: 'Site' },

  { key: 'procurement',         label: 'Procurement',         short: 'Buying',     icon: ShoppingCart,  accent: THEME.orange, group: 'Material' },
  { key: 'material_received',   label: 'Goods Received',      short: 'Received',   icon: PackageCheck,  accent: THEME.blue,   group: 'Material' },
  { key: 'items',               label: 'Items',               short: 'Items',      icon: Boxes,         accent: THEME.amber,  group: 'Material' },
  { key: 'vendors',             label: 'Vendors',             short: 'Vendors',    icon: Store,         accent: THEME.blue,   group: 'Material' },
  { key: 'challans',            label: 'Delivery Challan',    short: 'Challans',   icon: FileCheck2,    accent: THEME.green,  group: 'Material' },
  { key: 'transport',           label: 'Transport',           short: 'Transport',  icon: Truck,         accent: THEME.orange, group: 'Material' },
  { key: 'mtc',                 label: 'Test Certificates',   short: 'MTC',        icon: ScrollText,    accent: THEME.green,  group: 'Material' },
  { key: 'drawings',            label: 'Drawing Records',     short: 'Drawings',   icon: PenTool,       accent: THEME.blue,   group: 'Material' },
  { key: 'procurement_approve', label: 'Approve Requests',    short: 'Approve',    icon: Stamp,         accent: THEME.green,  group: 'Material', permissionOnly: true },

  { key: 'sites',               label: 'Sites',               short: 'Sites',      icon: Building2,     accent: THEME.blue,   group: 'Setup' },
  { key: 'team',                label: 'Team',                short: 'Team',       icon: Users,         accent: THEME.blue,   group: 'Setup' },
  { key: 'documents',           label: 'Documents',           short: 'Docs',       icon: FolderLock,    accent: THEME.amber,  group: 'Setup' },
  { key: 'hr_documents',        label: 'Worker ID & Aadhaar', short: 'Worker IDs', icon: IdCard,        accent: THEME.red,    group: 'Setup', permissionOnly: true },

  { key: 'payroll',             label: 'Payroll',             short: 'Payroll',    icon: Banknote,      accent: THEME.green,  group: 'Money' },
  { key: 'advances',            label: 'Weekly Advance',      short: 'Advances',   icon: Wallet,        accent: THEME.amber,  group: 'Money' },
  { key: 'attendance_register', label: 'Attendance Register', short: 'Register',   icon: CalendarCheck, accent: THEME.blue,   group: 'Money' },
  { key: 'reports',             label: 'Reports',             short: 'Reports',    icon: BarChart3,     accent: THEME.green,  group: 'Money' },
];

export const DASHBOARD = { key: 'dashboard', label: 'Dashboard', icon: Home, accent: THEME.orange };
export const ADMIN = { key: 'admin', label: 'Admin Control', icon: ShieldCheck, accent: THEME.red };

export const GROUPS = ['Site', 'Material', 'Setup', 'Money'];

export const moduleByKey = (key) => MODULES.find((m) => m.key === key);
export const SCREENS = MODULES.filter((m) => !m.permissionOnly);

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
