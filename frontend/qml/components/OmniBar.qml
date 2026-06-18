import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Dialogs 1.3

Item {
    id: root
    signal submitUrl(string url)
    signal openFile(string path)

    Rectangle {
        anchors.fill: parent
        color: "#161b27"

        Row {
            anchors { verticalCenter: parent.verticalCenter; left: parent.left; right: parent.right; leftMargin: 12; rightMargin: 12 }
            spacing: 8

            TextField {
                id: urlInput
                width: parent.width - openBtn.width - 20
                height: 32
                placeholderText: "YouTube URL or search…"
                color: "#e2e8f0"
                background: Rectangle { color: "#1e2535"; radius: 6 }
                Keys.onReturnPressed: root.submitUrl(urlInput.text.trim())
            }

            Button {
                id: openBtn
                text: "Open file"
                height: 32
                onClicked: fileDialog.open()
            }
        }
    }

    FileDialog {
        id: fileDialog
        title: "Open audio file"
        nameFilters: ["Audio files (*.mp3 *.wav *.flac *.aac *.ogg *.m4a *.opus *.webm *.mp4)", "All files (*)"]
        onAccepted: root.openFile(fileDialog.fileUrl.toString().replace("file:///", ""))
    }
}
