import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata={title:'Worm Arena Online',description:'Heavy-physics multiplayer worm arena.'};
export const viewport: Viewport={width:'device-width',initialScale:1,maximumScale:1,userScalable:false,themeColor:'#071016',viewportFit:'cover'};
export default function RootLayout({children}:Readonly<{children:ReactNode}>){return <html lang="ru"><body>{children}</body></html>}
