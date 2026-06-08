import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtQuick.Window 2.15
import "../components"

ApplicationWindow {
    id: root
    visible: true
    width: 1440
    height: 900
    minimumWidth: 1100
    minimumHeight: 700
    title: "Aegis Score Studio"

    // ── State ──────────────────────────────────────────────────────────────
    property string scene: "empty"   // empty | processing | success | error
    property var    liveJob: null
    property string sessionId: ""
    property real   progress: 0.0
    property int    stage: -1

    // ── Bridge connections ─────────────────────────────────────────────────
    Connections {
        target: AppBridge

        function onSessionStarted(sid) {
            root.sessionId = sid
            root.scene = "processing"
            root.progress = 0.0
        }

        function onProgressChanged(prog, stg, status) {
            root.progress = prog
            root.stage    = stg
        }

        function onAnalysisReady(job) {
            root.liveJob = job
            root.scene   = "success"
        }

        function onErrorOccurred(msg) {
            root.scene = "error"
            errorMessage.text = msg
        }
    }

    // ── Layout ─────────────────────────────────────────────────────────────
    RowLayout {
        anchors.fill: parent
        spacing: 0

        // Left sidebar
        Sidebar {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
            job: root.liveJob
        }

        // Center: score / processing / empty
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: "#0f1117"

            Loader {
                anchors.fill: parent
                source: {
                    if (root.scene === "processing") return "../views/ProcessingView.qml"
                    if (root.scene === "success")    return "../views/ScoreView.qml"
                    if (root.scene === "error")      return "../views/ErrorView.qml"
                    return "../views/EmptyView.qml"
                }
                onLoaded: {
                    if (root.scene === "processing") item.progress = Qt.binding(()=> root.progress)
                    if (root.scene === "success")    item.job      = Qt.binding(()=> root.liveJob)
                }
            }
        }

        // Right inspector
        Inspector {
            Layout.preferredWidth: 260
            Layout.fillHeight: true
            job: root.liveJob
            sessionId: root.sessionId
        }
    }

    // ── Omnibar (top) — future: promote to real toolbar ───────────────────
    OmniBar {
        id: omni
        anchors { top: parent.top; left: parent.left; right: parent.right }
        height: 46
        onSubmitUrl: (url) => AppBridge.analyzeUrl(url)
        onOpenFile:  (path) => AppBridge.openLocalFile(path)
    }

    // Nudge content down below omnibar
    Item {
        id: omniSpacer
        anchors { top: omni.bottom; left: parent.left; right: parent.right }
        height: 0
    }

    // ── Error label (temp) ────────────────────────────────────────────────
    Label {
        id: errorMessage
        visible: root.scene === "error"
        anchors.centerIn: parent
        color: "#f87171"
    }
}
