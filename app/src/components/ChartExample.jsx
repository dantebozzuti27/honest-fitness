/**
 * Example usage of the unified chart system
 * Shows how to integrate ChartCard + UnifiedChart
 */

import { useState } from 'react'
import ChartCard from './ChartCard'
import UnifiedChart from './UnifiedChart'

export default function ChartExample() {
  const [selectedCategory, setSelectedCategory] = useState('Workouts')
  const [selectedDateRange, setSelectedDateRange] = useState('This Week')
  const [selectedChartType, setSelectedChartType] = useState('Bar')

  // Example data
  const workoutData = {
    '2024-01-15': 1,
    '2024-01-16': 0,
    '2024-01-17': 1,
    '2024-01-18': 2,
    '2024-01-19': 1,
    '2024-01-20': 0,
    '2024-01-21': 1
  }

  const volumeData = {
    '2024-01-15': 45,
    '2024-01-16': 0,
    '2024-01-17': 52,
    '2024-01-18': 68,
    '2024-01-19': 48,
    '2024-01-20': 0,
    '2024-01-21': 55
  }

  const categories = [
    { id: 'Workouts', label: 'Workouts' },
    { id: 'Volume', label: 'Volume' },
    { id: 'Duration', label: 'Duration' },
    { id: 'Intensity', label: 'Intensity' }
  ]

  const dateRangePresets = [
    { id: 'This Week', label: 'This Week' },
    { id: 'This Month', label: 'This Month' },
    { id: 'Last 30 Days', label: 'Last 30 Days' },
    { id: 'Custom', label: 'Custom' }
  ]

  const chartData = selectedCategory === 'Workouts' ? workoutData : volumeData

  const insights = [
    {
      icon: '↑',
      text: '23% increase',
      value: 'in workouts this week'
    },
    {
      icon: '→',
      text: 'On track to hit',
      value: '12 workouts this month'
    },
    {
      icon: '•',
      text: 'Best performance days:',
      value: 'Tuesday, Thursday'
    }
  ]

  return (
    <ChartCard
      title="Workout Frequency"
      subtitle="Last 7 days"
      categories={categories}
      selectedCategory={selectedCategory}
      onCategoryChange={setSelectedCategory}
      dateRangePresets={dateRangePresets}
      selectedDateRange={selectedDateRange}
      onDateRangeChange={setSelectedDateRange}
      chartTypes={['Bar', 'Line', 'Area']}
      selectedChartType={selectedChartType}
      onChartTypeChange={setSelectedChartType}
      insights={insights}
      primaryAction={{
        label: 'Log Workout',
        onClick: () => console.log('Log workout clicked')
      }}
      secondaryActions={[
        {
          label: 'View Details',
          onClick: () => console.log('View details clicked')
        }
      ]}
      onShare={() => console.log('Share clicked')}
      onExport={() => console.log('Export clicked')}
      dataFreshness="2 hours ago"
    >
      <UnifiedChart
        data={chartData}
        dates={Object.keys(chartData)}
        type={selectedChartType.toLowerCase()}
        height={200}
        color="var(--accent)"
        showValues={true}
        xAxisLabel="Date"
        yAxisLabel={selectedCategory}
        onDateRangeChange={(range) => {
          console.log('Date range changed:', range)
        }}
      />
    </ChartCard>
  )
}

