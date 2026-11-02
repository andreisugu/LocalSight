import React from 'react';
import { useSecurity } from '../../context/SecurityContext';
import { USE_MOCK } from '../../services/api';
import { printAsPdf } from '../../utils/print';
import { copyIncidentLink } from '../../utils/incidentDetail';
import IncidentEmptyState from '../incidents/IncidentEmptyState';
import IncidentHeader from '../incidents/IncidentHeader';
import EvidencePanel from '../incidents/EvidencePanel';
import ReportPanel from '../incidents/ReportPanel';
import DecisionPanel from '../incidents/DecisionPanel';

// Screen shell only. Every rule the page depends on (times, timeline, action matrix,
// report label, download eligibility) is a pure function in utils/incidentDetail.js and is
// covered by node tests; this file wires those values to the context actions.
function IncidentDetailView() {
  const {
    selectedEvent,
    setCurrentView,
    setSelectedCameraId,
    acknowledgeEvent,
    markFalsePositive,
    reopenEvent,
    regenerateReport,
    showToast,
  } = useSecurity();

  const backToList = () => setCurrentView('incidents');

  if (!selectedEvent) return <IncidentEmptyState onBack={backToList} />;

  // The address bar already holds the deep link; copying it is one click, and a failed
  // clipboard (permissions, insecure context) still tells the operator where it is.
  const copyLink = async () => {
    const copied = await copyIncidentLink(window.location.href, (text) => navigator.clipboard.writeText(text));
    showToast(
      copied
        ? 'Link copiat. Îl poți trimite în Slack sau într-un tichet.'
        : 'Copierea a eșuat; linkul este în bara de adrese.'
    );
  };

  const openCameraNow = () => {
    setSelectedCameraId(selectedEvent.camera_id); setCurrentView('live');
  };

  return (
    <div className="flex-1 h-full overflow-y-auto p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4 select-none">
        <IncidentHeader
          event={selectedEvent}
          mock={USE_MOCK}
          onBack={backToList}
          onCopyLink={copyLink}
          onViewCamera={openCameraNow}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <EvidencePanel event={selectedEvent} />

          <div className="space-y-4 min-w-0">
            <ReportPanel
              event={selectedEvent}
              mock={USE_MOCK}
              onRetry={() => regenerateReport(selectedEvent.event_id)}
            />
            <DecisionPanel
              event={selectedEvent}
              onAck={(clickEvent) => acknowledgeEvent(selectedEvent.event_id, clickEvent)}
              onFalsePositive={(note) => markFalsePositive(selectedEvent.event_id, note)}
              onReopen={() => reopenEvent(selectedEvent.event_id)}
              onExport={() => printAsPdf(`LocalSight_incident_${selectedEvent.event_id}`)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default IncidentDetailView;
