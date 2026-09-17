import { Link } from 'react-router-dom';
import { ArrowLeft, Archive } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { moduleByKey } from '../config/modules';
import { SectionHeader, LockBanner, Btn } from '../components/ui';
import Roster from './team/Roster';

const MODULE = moduleByKey('team');

export default function TeamArchive() {
  const { canEdit, locks } = useAuth();
  const editable = canEdit('team');
  const locked = !!locks.team;

  return (
    <div>
      <SectionHeader title="Team Archive" subtitle="Workers who have left, with the day they left" icon={Archive} accent={MODULE.accent}
        action={<Link to="/team"><Btn variant="ghost" icon={ArrowLeft}>Back to Team</Btn></Link>} />
      <LockBanner locked={locked} readOnly={!editable && !locked} />
      <Roster archived editable={editable && !locked} />
    </div>
  );
}
