"use client";

import { Canvas } from "@react-three/fiber";
import { Environment, Float, MeshTransmissionMaterial, Sphere, Torus } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

function FloatingObjects() {
  return (
    <>
      <Float speed={1.5} rotationIntensity={0.2} floatIntensity={1.2}>
        <Sphere args={[0.5, 64, 64]} position={[-3.5, 0.8, -2]}>
          <MeshTransmissionMaterial
            backside
            backsideThickness={0.15}
            thickness={0.4}
            chromaticAberration={0.02}
            anisotropicBlur={0.05}
            roughness={0}
            metalness={0}
            ior={1.5}
            color="#e5e5ea"
            transparent
            opacity={0.15}
          />
        </Sphere>
      </Float>

      <Float speed={1.2} rotationIntensity={0.3} floatIntensity={1.5}>
        <Torus args={[0.4, 0.08, 32, 64]} position={[3.2, -0.5, -1.5]}>
          <MeshTransmissionMaterial
            backside
            thickness={0.2}
            chromaticAberration={0.03}
            anisotropicBlur={0.04}
            roughness={0}
            metalness={0}
            ior={1.3}
            color="#c0c0c0"
            transparent
            opacity={0.12}
          />
        </Torus>
      </Float>

      <Float speed={2} rotationIntensity={0.15} floatIntensity={0.8}>
        <Sphere args={[0.25, 32, 32]} position={[0, -1.8, 1]}>
          <MeshTransmissionMaterial
            backside
            thickness={0.15}
            chromaticAberration={0.02}
            roughness={0}
            metalness={0}
            ior={1.6}
            color="#ffffff"
            transparent
            opacity={0.1}
          />
        </Sphere>
      </Float>

      <Float speed={1.8} rotationIntensity={0.4} floatIntensity={1.3}>
        <Torus args={[0.2, 0.04, 24, 48]} position={[-2, -1, 2]}>
          <MeshTransmissionMaterial
            backside
            thickness={0.1}
            chromaticAberration={0.03}
            roughness={0.05}
            metalness={0}
            ior={1.4}
            color="#e5e5ea"
            transparent
            opacity={0.1}
          />
        </Torus>
      </Float>
    </>
  );
}

function generatePositions() {
  const count = 120;
  const positions = new Float32Array(count * 3);
  let s = 42;
  for (let i = 0; i < count * 3; i++) {
    s = (s * 16807) % 2147483647;
    const r = (s - 1) / 2147483646;
    positions[i] = (r - 0.5) * 20;
  }
  return positions;
}

const PARTICLE_POSITIONS = generatePositions();

function Particles() {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(PARTICLE_POSITIONS, 3));
    return geo;
  }, []);

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={0.01}
        color="#aeaeb2"
        transparent
        opacity={0.15}
        sizeAttenuation
      />
    </points>
  );
}

function StudioEnvironment() {
  return (
    <Environment resolution={128}>
      <mesh>
        <sphereGeometry args={[5, 32, 32]} />
        <meshBasicMaterial color="#222226" side={THREE.BackSide} />
      </mesh>
    </Environment>
  );
}

function Lighting() {
  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color="#ffffff" />
      <pointLight position={[-5, 3, -5]} intensity={0.4} color="#e5e5ea" />
      <pointLight position={[0, -5, 3]} intensity={0.2} color="#c0c0c0" />
    </>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 w-full h-screen overflow-hidden">
      <Canvas camera={{ position: [0, 0, 6], fov: 40 }} dpr={[1, 2]} className="pointer-events-none">
        <Suspense fallback={null}>
          <color attach="background" args={["#0f0f11"]} />
          <Lighting />
          <FloatingObjects />
          <Particles />
          <StudioEnvironment />
        </Suspense>
      </Canvas>
    </div>
  );
}
