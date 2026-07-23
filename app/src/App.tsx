import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { CityScene } from './city/CityScene';
import { LodProvider } from './city/LodProvider';
import { Floor } from './city/Floor';
import { GroundHaze, Grounding } from './city/Atmosphere';
import { PaintSplatters } from './city/PaintSplatters';
import { Backdrop } from './city/Backdrop';
import { QualityController } from './city/QualityController';
import { InspectorPanel } from './InspectorPanel';
import { Sidebar } from './hud/Sidebar';
import { Modal } from './hud/Modal';
import { CornerWatermark } from './hud/CornerWatermark';
import { Splash } from './hud/Splash';
import { EmbedBridge } from './EmbedBridge';
import { useStudio } from './store';

export function App() {
  const project = useStudio((s) => s.project);
  const sel = useStudio((s) => s.sel);
  const driverValues = useStudio((s) => s.driverValues);
  const setSel = useStudio((s) => s.setSel);
  const loadFromFile = useStudio((s) => s.loadFromFile);
  const dismiss = useStudio((s) => s.dismiss);
  const quality = useStudio((s) => s.quality);
  const readOnly = useStudio((s) => s.readOnly);
  const awaitingModel = useStudio((s) => s.awaitingModel);
  const horizon = project.horizonMonths ?? 12;
  const [splash, setSplash] = useState(() => {
    try {
      return sessionStorage.getItem('ss-splash') !== '1';
    } catch {
      return true;
    }
  });
  const endSplash = () => {
    try {
      sessionStorage.setItem('ss-splash', '1');
    } catch {
      /* ignore */
    }
    setSplash(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  return (
    <div
      style={{ position: 'fixed', inset: 0 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (readOnly) return;
        const f = e.dataTransfer.files[0];
        if (f) loadFromFile(f);
      }}
    >
      <Canvas
        shadows
        camera={{ position: [44, 48, 82], far: 2000, near: 0.5, fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true }}
        onPointerMissed={() => setSel(null)}
      >
        <QualityController />
        <color attach="background" args={['#05070f']} />
        <fogExp2 attach="fog" args={['#05070f', 0.0055]} />
        <ambientLight intensity={0.25} />
        <hemisphereLight args={['#334155', '#05070f', 0.35]} />
        <directionalLight
          position={[40, 70, 25]}
          intensity={0.7}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-45}
          shadow-camera-right={45}
          shadow-camera-top={45}
          shadow-camera-bottom={-45}
          shadow-camera-far={220}
        />
        <Floor />
        <GroundHaze />
        <Grounding />
        <PaintSplatters />
        <Backdrop />
        <Bounds fit margin={1.2} key={`${project.name}:${project.nodes.length}`}>
          <LodProvider>
            <CityScene />
          </LodProvider>
        </Bounds>
        <OrbitControls makeDefault target={[0, 4, 0]} maxPolarAngle={Math.PI * 0.49} />
        <EffectComposer key={quality} multisampling={quality === 'high' ? 4 : 0}>
          {[
            <Bloom
              key="bloom"
              intensity={1.2}
              luminanceThreshold={0.2}
              luminanceSmoothing={0.9}
              radius={0.7}
              mipmapBlur
            />,
            ...(quality === 'high'
              ? [<Vignette key="vignette" offset={0.2} darkness={0.7} eskil={false} />]
              : []),
          ]}
        </EffectComposer>
      </Canvas>

      <Sidebar />
      <CornerWatermark />

      {sel && (
        <InspectorPanel
          project={project}
          sel={sel}
          drivers={driverValues}
          horizon={horizon}
          onClose={() => setSel(null)}
        />
      )}
      <Modal />
      {splash && <Splash onDone={endSplash} />}
      <EmbedBridge />
      {awaitingModel && (
        <div className="awaiting">
          <div className="awaiting-dot" />
          <span>Loading project…</span>
        </div>
      )}
    </div>
  );
}
