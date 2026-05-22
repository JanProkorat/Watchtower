// Import order matters: browserStub installs window.watchtower (no-op in
// plain browser) BEFORE App's children call into it. In Electron this is
// already wired via contextBridge and the stub is a no-op.
import './browserStub.js';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.js';
import {DevSupport} from "@react-buddy/ide-toolbox";
import {ComponentPreviews, useInitial} from "../../dev";

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');
createRoot(container).render(
    <React.StrictMode>
          <DevSupport ComponentPreviews={ComponentPreviews}
                      useInitialHook={useInitial}
          >
                <App/>
          </DevSupport>
    </React.StrictMode>,
);
