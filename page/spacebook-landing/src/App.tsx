import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { Hero } from './components/sections/Hero';
import { Stats } from './components/sections/Stats';
import { Features } from './components/sections/Features';
import { HowItWorks } from './components/sections/HowItWorks';
import { Demo } from './components/sections/Demo';
import { Architecture } from './components/sections/Architecture';
import { TechStack } from './components/sections/TechStack';
import { CallToAction } from './components/sections/CallToAction';

function App() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Stats />
        <Features />
        <HowItWorks />
        <Demo />
        <Architecture />
        <TechStack />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}

export default App;
