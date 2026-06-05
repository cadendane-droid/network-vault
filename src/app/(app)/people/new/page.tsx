import AddPersonForm from '@/components/add-person-form';

export default function NewPersonPage() {
  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold text-zinc-900 mb-6">Add person</h1>
      <AddPersonForm />
    </div>
  );
}
