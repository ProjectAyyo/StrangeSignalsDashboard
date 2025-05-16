import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-900 to-blue-700 text-white py-20">
        <div className="container mx-auto px-4">
          <h1 className="text-5xl font-bold mb-6">We Generate Wealth Together</h1>
          <p className="text-xl mb-8">
            We aim to be the best investment firm ever conceived. Our goal is to find the smartest ways to use money 
            so we can make great long-term profits for top public and private organizations.
          </p>
          <Link 
            href="#services" 
            className="bg-white text-blue-900 px-8 py-3 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
          >
            Find out more
          </Link>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12">You can do it too!</h2>
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-xl mb-8">
              We refuse to &quot;gate-keep&quot; stock market knowledge. Are you ready to learn winning investment 
              and trading strategies?
            </p>
            <p className="text-lg mb-12">
              With the help of our hands on training courses, personalized trading plans and technical support, 
              you&apos;ll be able to generate consistent income from the markets with minimal effort. 
              Investing by yourself has never been easier!
            </p>
          </div>

          {/* Education Card */}
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-2xl mx-auto">
            <h3 className="text-2xl font-bold mb-4">Education</h3>
            <p className="mb-6">
              Hands on walk through of investment &amp; trading strategies.
            </p>
            <Link 
              href="#contact" 
              className="inline-block bg-blue-900 text-white px-6 py-2 rounded-lg hover:bg-blue-800 transition-colors"
            >
              Find out more
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="container mx-auto px-4 text-center">
          <div className="flex justify-center space-x-6 mb-6">
            <a href="#" className="hover:text-blue-400 transition-colors">Facebook</a>
            <a href="#" className="hover:text-blue-400 transition-colors">Twitter</a>
            <a href="#" className="hover:text-blue-400 transition-colors">LinkedIn</a>
          </div>
          <p className="text-sm">© {new Date().getFullYear()} by Strange Capital. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
