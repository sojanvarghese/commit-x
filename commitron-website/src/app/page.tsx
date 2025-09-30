import Hero from '@/components/Hero'
import Features from '@/components/Features'
import Installation from '@/components/Installation'
import Stats from '@/components/Stats'
import Footer from '@/components/Footer'
import Header from '@/components/Header'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <Header />
      <Hero />
      <Stats />
      <Features />
      <Installation />
      <Footer />
    </main>
  )
}
