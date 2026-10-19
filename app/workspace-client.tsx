'use client'

import dynamic from 'next/dynamic'

const Workspace = dynamic(() => import('../src/Workspace'), {
  ssr: false,
  loading: () => <p role="status">Loading BusinessOS...</p>,
})

export default function WorkspaceClient() {
  return <Workspace />
}
