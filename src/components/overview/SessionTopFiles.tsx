import type { TopFile } from '../../types'
import './SessionTopFiles.css'

interface Props {
  files: TopFile[]
}

export function SessionTopFiles({ files }: Props) {
  const topFiles = files.slice(0, 20)

  if (topFiles.length === 0) {
    return <div className="top-files-empty">ファイル編集の記録がありません</div>
  }

  return (
    <div className="top-files-wrapper">
      <table className="top-files-table">
        <thead>
          <tr>
            <th className="top-files-th top-files-th--rank">#</th>
            <th className="top-files-th top-files-th--path">File Path</th>
            <th className="top-files-th top-files-th--count">Edits</th>
          </tr>
        </thead>
        <tbody>
          {topFiles.map((file, i) => (
            <tr key={file.file} className="top-files-row">
              <td className="top-files-td top-files-td--rank">{i + 1}</td>
              <td className="top-files-td top-files-td--path" title={file.file}>
                {file.file}
              </td>
              <td className="top-files-td top-files-td--count">{file.editCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
