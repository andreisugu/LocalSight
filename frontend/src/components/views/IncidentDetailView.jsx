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

const SCREEN = 'flex-1 h-full overflow-y-auto p-4 md:p-6';
const SHELL = 'max-w-6xl mx-auto space-y-4 select-none';
const EVIDENCE_GRID = 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start';

/**
 * Everything a click on this page can do, built once per incident so the panels receive
 * plain callbacks. The screen itself does not know how an ack or a report is stored.
 */
function incidentActions(event, store) {
  const openView = (view) => store.setCurrentView(view);

  const goBack = () => openView('incidents');

  // The address bar already holds the deep link; copying it is one click, and a failed
  // clipboard (permissions, insecure context) still tells the operator where it is.
  const copyLink = async () => {
    const copied = await copyIncidentLink(window.location.href, (text) => navigator.clipboard.writeText(text));
    store.showToast(
      copied
        ? 'Link copiat. Îl poți trimite în Slack sau într-un tichet.'
        : 'Copierea a eșuat; linkul este în bara de adrese.'
    );
  };

  const viewCamera = () => {
    store.setSelectedCameraId(event.camera_id);
    openView('live');
  };

  const acknowledge = (clickEvent) => store.acknowledgeEvent(event.event_id, clickEvent);
  const flagFalsePositive = (note) => store.markFalsePositive(event.event_id, note);
  const reopen = () => store.reopenEvent(event.event_id);
  const retryReport = () => store.regenerateReport(event.event_id);
  const exportPdf = () => printAsPdf(`LocalSight_incident_${event.event_id}`);

  return { acknowledge, copyLink, exportPdf, flagFalsePositive, goBack, reopen, retryReport, viewCamera };
}

/** Report above, operator decisions below: one narrow column beside the evidence. */
function DecisionColumn({ event, actions }) {
  return (
    <div className="space-y-4 min-w-0">
      <ReportPanel event={event} mock={USE_MOCK} onRetry={actions.retryReport} />
      <DecisionPanel
        event={event}
        onAck={actions.acknowledge}
        onFalsePositive={actions.flagFalsePositive}
        onReopen={actions.reopen}
        onExport={actions.exportPdf}
      />
    </div>
  );
}

function IncidentDetailView() {
  const store = useSecurity();
  const { selectedEvent } = store;

  if (!selectedEvent) {
    return <IncidentEmptyState onBack={() => store.setCurrentView('incidents')} />;
  }

  const actions = incidentActions(selectedEvent, store);

  return (
    <div className={SCREEN}>
      <div className={SHELL}>
        <IncidentHeader
          event={selectedEvent}
          mock={USE_MOCK}
          onBack={actions.goBack}
          onCopyLink={actions.copyLink}
          onViewCamera={actions.viewCamera}
        />

        <div className={EVIDENCE_GRID}>
          <EvidencePanel event={selectedEvent} />
          <DecisionColumn event={selectedEvent} actions={actions} />
        </div>
      </div>
    </div>
  );
}

export default IncidentDetailView;
