import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtQuick.Window 2.15
import "../components"

ApplicationWindow {
    id: root
    visible: true
    width: 1440; height: 900
    minimumWidth: 1100; minimumHeight: 700
    title: "Aegis Score Studio"
    color: "#0b0e17"

    // ── Global state ───────────────────────────────────────────────────────
    property string scene:     "empty"
    property var    liveJob:   null
    property string sessionId: ""
    property real   progress:  0.0
    property int    stage:    -1
    property string errorMsg:  ""

    // ── Bridge connections ─────────────────────────────────────────────────
    Connections {
        target: AppBridge

        function onSessionStarted(sid) {
            root.sessionId = sid
            root.scene     = "processing"
            root.progress  = 0.0
            root.liveJob   = null
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
            root.errorMsg = msg
            root.scene    = "error"
        }
    }

    // ── Flash toast ────────────────────────────────────────────────────────
    property alias flashText: flashToast.message
    function flash(msg) { flashToast.show(msg) }

    FlashToast { id: flashToast; anchors { bottom: parent.bottom; horizontalCenter: parent.horizontalCenter; bottomMargin: 24 } }

    // ── Layout ─────────────────────────────────────────────────────────────
    // Omnibar fixed at top
    OmniBar {
        id: omni
        anchors { top: parent.top; left: parent.left; right: parent.right }
        height: 46
        onSubmitUrl:  (url)  => AppBridge.analyzeUrl(url)
        onOpenFile:   (path) => AppBridge.openLocalFile(path)
    }

    RowLayout {
        anchors { top: omni.bottom; left: parent.left; right: parent.right; bottom: statusBar.top }
        spacing: 0

        // Left sidebar
        Sidebar {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
            job: root.liveJob
            onLoadSession: (sid) => { /* TODO: restore session */ }
        }

        // Divider
        Rectangle { Layout.preferredWidth: 1; Layout.fillHeight: true; color: "#1a2035" }

        // Center content
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true

            // Scene switcher
            Loader {
                id: centerLoader
                anchors.fill: parent

                states: [
                    State { name: "empty";      when: root.scene === "empty";      PropertyChanges { target: centerLoader; source: "../views/EmptyView.qml" } },
                    State { name: "processing"; when: root.scene === "processing"; PropertyChanges { target: centerLoader; source: "../views/ProcessingView.qml" } },
                    State { name: "success";    when: root.scene === "success";    PropertyChanges { target: centerLoader; source: "../views/ScoreView.qml" } },
                    State { name: "error";      when: root.scene === "error";      PropertyChanges { target: centerLoader; source: "../views/ErrorView.qml" } }
                ]

                onLoaded: {
                    if (root.scene === "processing") {
                        item.progress = Qt.binding(() => root.progress)
                        item.stage    = Qt.binding(() => root.stage)
                    }
                    if (root.scene === "success") {
                        item.job       = Qt.binding(() => root.liveJob)
                        item.sessionId = Qt.binding(() => root.sessionId)
                    }
                    if (root.scene === "error") {
                        item.message = Qt.binding(() => root.errorMsg)
                    }
                }
            }
        }

        // Divider
        Rectangle { Layout.preferredWidth: 1; Layout.fillHeight: true; color: "#1a2035" }

        // Right inspector
        Inspector {
            Layout.preferredWidth: 270
            Layout.fillHeight: true
            job:       root.liveJob
            sessionId: root.sessionId
            onExportMidi: _downloadStems("midi")
            onExportWav:  _downloadStems("wav")
        }
    }

    // Status bar
    Rectangle {
        id: statusBar
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
        height: 24
        color: "#070b13"
        border { width: 0; color: "transparent" }

        Row {
            anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 12 }
            spacing: 20
            Text { text: _sceneLabel();              color: "#475569"; font.pixelSize: 11 }
            Text { text: _gpuLabel();                color: "#334155"; font.pixelSize: 11 }
            Text { text: _audioLabel();              color: "#334155"; font.pixelSize: 11 }
        }

        Text {
            anchors { verticalCenter: parent.verticalCenter; right: parent.right; rightMargin: 12 }
            text: "Aegis Score Studio v0.1"
            color: "#1e2d42"; font.pixelSize: 10
        }
    }

    function _sceneLabel() {
        const map = { empty:"Idle", processing:"Analyzing…", success:"Ready", error:"Error" }
        return map[root.scene] || ""
    }
    function _gpuLabel() {
        if (!root.liveJob) return ""
        const g = root.liveJob.meta.gpu
        return g.model + (g.vramTotal > 0 ? " · " + g.vram.toFixed(1) + "/" + g.vramTotal.toFixed(1) + " GB" : "")
    }
    function _audioLabel() {
        if (!root.liveJob) return ""
        const m = root.liveJob.meta
        return (m.sampleRate/1000).toFixed(0) + " kHz · " + m.bitDepth + "-bit"
    }

    function _downloadStems(type) {
        if (!root.liveJob) return
        const sid = root.sessionId
        root.liveJob.stems.forEach(function(s) {
            const url = type === "midi" ? s.midi_url : s.audio_url
            if (url) Qt.openUrlExternally("http://127.0.0.1:7471" + url)
        })
        root.flash("Downloading " + type.toUpperCase() + " files…")
    }
}
