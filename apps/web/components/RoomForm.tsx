import React from 'react';
import { Room, PreviousReportAttachment } from '../types';
import { AreaWorkspace } from './inspection/AreaWorkspace';

interface RoomFormProps {
  room: Room;
  onUpdate: (updatedRoom: Room) => void;
  onDelete: () => void;
  previousReport?: PreviousReportAttachment;
  previousReportNotes?: string;
  agencyId?: string;
  readOnly?: boolean;
}

const RoomForm: React.FC<RoomFormProps> = ({
  room,
  onUpdate,
  onDelete,
  previousReport,
  previousReportNotes,
  agencyId,
  readOnly = false,
}) => {
  return (
    <AreaWorkspace
      area={room}
      onUpdateArea={onUpdate}
      onDeleteArea={onDelete}
      previousReport={previousReport}
      previousReportNotes={previousReportNotes}
      agencyId={agencyId}
      readOnly={readOnly}
    />
  );
};

export default RoomForm;
