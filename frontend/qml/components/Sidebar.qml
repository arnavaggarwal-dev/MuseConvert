import QtQuick 2.15
import QtQuick.Controls 2.15

Rectangle {
    id: root
    property var job: null
    signal loadSession(string sid)
    color: "#090d18"

    Column {
        anchors { top: parent.top; left: parent.left; right: parent.right; topMargin: 0 }
        spacing: 0

        // Section: current stems
        Rectangle {
            width: parent.width; height: 36
            color: "#0d1220"
            Text {
                anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 16 }
                text: "STEMS"; color: "#334155"; font.pixelSize: 10; font.letterSpacing: 1.5
            }
            Text {
                anchors { verticalCenter: parent.verticalCenter; right: parent.right; rightMargin: 16 }
                text: job ? job.stems.length : "0"; color: "#475569"; font.pixelSize: 11
            }
        }

        Repeater {
            model: job ? job.stems : []

            Rectangle {
                width: root.width; height: 52
                color: stemMouse.containsMouse ? "#111a2e" : "transparent"

                MouseArea { id: stemMouse; anchors.fill: parent; hoverEnabled: true }

                Row {
                    anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 12 }
                    spacing: 10

                    // Color swatch
                    Rectangle {
                        width: 3; height: 36; radius: 2
                        color: _stemColor(modelData.color)
                        anchors.verticalCenter: parent.verticalCenter
                    }

                    // Icon placeholder
                    Rectangle {
                        width: 32; height: 32; radius: 6
                        color: Qt.rgba(Qt.lighter(_stemColor(modelData.color), 1.2).r,
                                       Qt.lighter(_stemColor(modelData.color), 1.2).g,
                                       Qt.lighter(_stemColor(modelData.color), 1.2).b, 0.12)
                        anchors.verticalCenter: parent.verticalCenter
                        Text {
                            anchors.centerIn: parent
                            text: _stemIcon(modelData.id)
                            font.pixelSize: 14
                        }
                    }

                    Column {
                        spacing: 3; anchors.verticalCenter: parent.verticalCenter
                        Text { text: modelData.name;       color: "#cbd5e1"; font.pixelSize: 12; font.weight: Font.Medium }
                        Text { text: modelData.instrument; color: "#475569"; font.pixelSize: 10 }
                        Text {
                            text: modelData.midi + " notes · " + Math.round(modelData.confidence) + "%"
                            color: modelData.confidence >= 90 ? "#34d399" : modelData.confidence >= 78 ? "#fbbf24" : "#f87171"
                            font.pixelSize: 10
                        }
                    }
                }
            }
        }

        // Divider
        Rectangle { width: parent.width; height: 1; color: "#131c2e"; visible: job !== null }

        // Section: history (fetched from backend)
        Rectangle {
            width: parent.width; height: 36
            color: "#0d1220"
            Text {
                anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 16 }
                text: "RECENT"; color: "#334155"; font.pixelSize: 10; font.letterSpacing: 1.5
            }
        }

        ListView {
            width: parent.width
            height: Math.min(contentHeight, 200)
            clip: true
            model: histModel
            delegate: Rectangle {
                width: root.width; height: 46
                color: hm.containsMouse ? "#111a2e" : "transparent"
                MouseArea { id: hm; anchors.fill: parent; hoverEnabled: true; onClicked: root.loadSession(model.id) }
                Column {
                    anchors { left: parent.left; leftMargin: 16; verticalCenter: parent.verticalCenter }
                    spacing: 3
                    Text { text: model.title||"Untitled"; color: "#94a3b8"; font.pixelSize: 12; elide: Text.ElideRight; width: root.width-32 }
                    Text { text: model.artist + " · " + model.stem_count + " stems"; color: "#475569"; font.pixelSize: 10 }
                }
            }
        }
    }

    // Fetch history on load
    ListModel { id: histModel }

    Component.onCompleted: _fetchHistory()

    function _fetchHistory() {
        const xhr = new XMLHttpRequest()
        xhr.open("GET", "http://127.0.0.1:7471/api/history?limit=20")
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
                const items = JSON.parse(xhr.responseText)
                histModel.clear()
                for (let i = 0; i < items.length; i++) histModel.append(items[i])
            }
        }
        xhr.send()
    }

    function _stemColor(cssVar) {
        const map = { "--s-drums":"#f97316","--s-bass":"#a855f7","--s-guitar":"#22c55e",
                      "--s-keys":"#3b82f6","--s-vocal":"#ec4899","--s-synth":"#06b6d4",
                      "--s-strings":"#84cc16","--s-brass":"#eab308","--s-wood":"#14b8a6","--s-perc":"#f59e0b" }
        return map[cssVar] || "#60a5fa"
    }
    function _stemIcon(id) {
        const map = { drums:"🥁", bass:"🎸", guitar:"🎸", piano:"🎹", vocals:"🎤", other:"🎵" }
        return map[id] || "🎵"
    }
}
